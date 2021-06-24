const db = require('./lib/database')
const core = require('@actions/core')
const {Octokit} = require("@octokit/rest")
const {retry} = require("@octokit/plugin-retry");
const {throttling} = require("@octokit/plugin-throttling");

const _token = core.getInput('token', {required: true})
const _owner = core.getInput('owner', {required: true})
const _days = core.getInput('days', {required: true})
const _guidelines = core.getInput('guidelines', {required: false})
const _adminTeam = core.getInput('adminTeam', {required: true})
const _email = core.getInput('adminEmail', {required: true})

const _Octokit = Octokit.plugin(retry, throttling)
const octokit = new _Octokit({
    auth: _token,
    throttle: {
        onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
            if (options.request.retryCount === 0) {
                octokit.log.info(`Retrying after ${retryAfter} seconds!`);
                return true;
            }
        },
        onAbuseLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`);
        },
    }
})

async function collect(owner, days) {
    try {
        const repos = await octokit.paginate(octokit.repos.listForOrg, {
            org: owner,
            per_page: 100,
            type: 'all'
        })

        const orgAdmins = await getOrgOwners(owner)
        const backdate = new Date()
        backdate.setDate(backdate.getDate() - days)

        for (const repo of repos) {
            try {
                const scanned = await db.scanned(repo.name)
                const lastPushed = new Date(repo.pushed_at)
                const _lastNotified = await db.getLastNotified(repo.name)
                const lastNotified = new Date(_lastNotified)
                if (!scanned && !repo.archived && lastPushed < backdate) {
                    await db.addRepo(repo.name, {
                        owner: repo.owner.login,
                        name: repo.name,
                        url: repo.html_url,
                        hasIssues: repo.has_issues,
                        lastUpdated: lastPushed,
                        lastNotified: null,
                        admins: [],
                        adminTeamMembers: [],
                        notified: false,
                        issueNumber: null
                    })
                    await updateAdmins(repo, orgAdmins)
                } else if (lastNotified && lastNotified < backdate) {
                    await db.setNotified(repo.name, false)
                    await db.setIssueNumber(repo.name, null)
                    await db.setLastNotified(repo.name, null)
                    await updateAdmins(repo, orgAdmins)
                }
            } catch (e) {
                console.log(`Unable to scan repository [${repo.name}]: ${e.message}`)
            }
        }
    } catch (e) {
        throw e
    }
}

async function getOrgOwners(org) {
    try {
        const admins = await octokit.paginate(octokit.orgs.listMembers, {
            org: org,
            role: 'admin',
            per_page: 100
        })
        return admins.map(admin => admin.login)
    } catch (e) {
        throw e
    }
}

async function getTeams(owner, repo) {
    try {
        return await octokit.paginate(octokit.rest.repos.listTeams, {
            owner: owner,
            repo: repo,
            per_page: 100
        })
    } catch (e) {
        throw e
    }
}

async function getTeamMembers(org, slug) {
    try {
        return await octokit.paginate(octokit.teams.listMembersInOrg, {
            org: org,
            team_slug: slug,
            role: 'all',
            per_page: 100
        })
    } catch (e) {
        throw e
    }
}

async function getCollaborators(owner, repo) {
    try {
        return await octokit.paginate(octokit.rest.repos.listCollaborators, {
            owner: owner,
            repo: repo,
            per_page: 100
        })
    } catch (e) {
        throw e
    }
}

async function enableIssues() {
    try {
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (!repo.hasIssues) {
                await octokit.repos.update({
                    owner: repo.owner,
                    repo: repo.name,
                    hasIssues: true
                })
                await db.setIssuesEnabled(repo.name)
            }
        }
    } catch (e) {
        throw e
    }
}

async function openIssues() {
    try {
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (!repo.notified && !repo.issueNumber) {
                let issue
                try {
                    issue = await octokit.issues.create({
                        owner: repo.owner,
                        repo: repo.name,
                        title: 'Notice: This repository has been marked for archival, please respond',
                        body: issueBody,
                        assignees: uniq(repo.admins.concat(repo.adminTeamMembers))
                    })
                } catch (e) {
                    console.log(`Unable to open issue in repository [${repo.name}]: ${e.message}`)
                    continue
                }
                await db.setIssueNumber(repo.name, issue.data.number)
                await db.setLastNotified(repo.name, issue.data.created_at)
                await db.setNotified(repo.name, true)
            }
        }
    } catch (e) {
        throw e
    }
}

async function updateAdmins(repo, orgAdmins) {
    try {
        const adminTeamMembers = []
        const teams = await getTeams(repo.owner.login, repo.name)
        for (const team of teams) {
            if (team.permissions.admin || team.permissions.push) {
                const members = await getTeamMembers(repo.owner.login, team.slug)
                for (const member of members) {
                    adminTeamMembers.push(member.login)
                }
            }
        }
        const admins = []
        const collaborators = await getCollaborators(repo.owner.login, repo.name)
        for (const collaborator of collaborators) {
            if (!adminTeamMembers.includes(collaborator.login) && !orgAdmins.includes(collaborator.login)) {
                if (collaborator.permissions.admin || collaborator.permissions.push) {
                    admins.push(collaborator.login)
                }
            }
        }
        await db.setAdmins(repo.name, uniq(admins))
        await db.setTeamMembers(repo.name, uniq(adminTeamMembers))
    } catch (e) {
        throw e
    }
}

async function uniq(array) {
    return [...new Set(array)]
}

let issueBody = `
Repository Admins and Contributors,

Your repository has been identified as having been inactive for a period of time greater than ${_days} days. The policy of the ${_owner} organizations states that repositories without code contributions for ${_days} are subject to automated archival.

We recognize that some repositories may be inactive for various reasons, and being inactive due to lack of code contributions does not necessarily mean the repository itself is inactive.

Remember, archiving a repository does not delete the repository, it remains fully available to current users,  and can be unarchived at any time. Existing URL's will continue to work. Archiving a repository lets users know that this code is unmaintained, and its use should be vetted by users looking to consume it.

Repository admins and contributors with write access have 30 days to perform one of the following actions to allow this action to take place or to prevent their repository from archival:
- Add the \`archive\` label to this issue, which will cause this repository to be archived at the end of the 30 day waiting period
- Add the \`do-not-archive\` label to this issue, which will prevent this repository from being archived for ${_days} days, at which time the process will repeat itself
- Add the \`do-not-archive\` topic to repository, this will prevent your repo from ever being flagged again
- Do nothing, and your repository will be automatically archived at the end of the 30 day waiting period
- Archive the repository yourself by navigating to \`settings\` and selecting the \`Archive this repository\` button at the bottom of the page

For questions or concerns please comment on this issue and tag the @${_owner}/${_adminTeam} in the comment. You can also reach the GitHub admin team directly via email at: ${_email}
`

if (_guidelines !== "") {
    issueBody += `

For information on the ${_owner} archival guidelines please see this page: ${_guidelines}
`
}

async function main() {
    try {
        await collect(_owner, _days)
        await enableIssues()
        await openIssues()
    } catch (e) {
        console.log(`ERROR: ${e.message}`)
    }
}

main()
