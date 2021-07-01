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
        core.info(`Querying repositories for organization: ${owner}`)
        const repos = await octokit.paginate(octokit.repos.listForOrg, {
            org: owner,
            per_page: 100,
            type: 'all'
        })
        core.info(`Found ${repos.length} repos`)

        const backdate = new Date()
        backdate.setDate(backdate.getDate() - days)

        const orgAdmins = await getOrgOwners(owner)
        for (const repo of repos) {
            try {
                const scanned = await db.scanned(repo.name)
                const lastPushed = new Date(repo.pushed_at)
                const _lastNotified = await db.getLastNotified(repo.name)
                const lastNotified = new Date(_lastNotified)
                if (!scanned && !repo.archived && lastPushed < backdate) {
                    core.info(`Scanning dormant repository: ${repo.name}`)
                    const admins = await getAdmins(repo, orgAdmins)
                    await db.addRepo(repo.name, {
                        owner: repo.owner.login,
                        name: repo.name,
                        url: repo.html_url,
                        hasIssues: repo.has_issues,
                        lastUpdated: lastPushed,
                        lastNotified: null,
                        admins: admins.admins,
                        adminTeamMembers: admins.adminTeamMembers,
                        notified: false,
                        issueNumber: null
                    })
                } else if (lastNotified && lastNotified < backdate) {
                    core.info(`Rescanning previously scanned repository: ${repo.name}`)
                    await db.setNotified(repo.name, false)
                    await db.setIssueNumber(repo.name, null)
                    await db.setLastNotified(repo.name, null)

                    const admins = await getAdmins(repo, orgAdmins)
                    await db.setAdmins(repo.name, admins.admins)
                    await db.setTeamMembers(repo.name, admins.adminTeamMembers)
                } else {
                    core.info(`Skipping non-dormant repository: ${repo.name}`)
                }
            } catch (error) {
                core.warning(`Unable to scan repository ${repo.owner.login}/${repo.name}: ${error.message}`)
            }
        }
    } catch (error) {
        throw new Error(`Failed querying repos: ${error.message}`)

    }
}

async function getOrgOwners(org) {
    try {
        core.info('Query organization admins')
        const admins = await octokit.paginate(octokit.orgs.listMembers, {
            org: org,
            role: 'admin',
            per_page: 100
        })
        return admins.map(admin => admin.login)
    } catch (error) {
        throw error
    }
}

async function getTeams(owner, repo) {
    try {
        core.info('Querying repository teams')
        return await octokit.paginate(octokit.rest.repos.listTeams, {
            owner: owner,
            repo: repo,
            per_page: 100
        })
    } catch (error) {
        throw error
    }
}

async function getTeamMembers(org, slug) {
    try {
        core.info('Querying team members')
        return await octokit.paginate(octokit.teams.listMembersInOrg, {
            org: org,
            team_slug: slug,
            role: 'all',
            per_page: 100
        })
    } catch (error) {
        throw error
    }
}

async function getCollaborators(owner, repo) {
    try {
        core.info('Querying repository collaborators')
        return await octokit.paginate(octokit.rest.repos.listCollaborators, {
            owner: owner,
            repo: repo,
            per_page: 100
        })
    } catch (error) {
        throw error
    }
}

async function enableIssues() {
    try {
        core.info('Enabling issues')
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (!repo.hasIssues) {
                core.info(`Enabling issues for ${repo.name}`)
                await octokit.repos.update({
                    owner: repo.owner,
                    repo: repo.name,
                    has_issues: true
                })
                await db.setIssuesEnabled(repo.name)
            }
        }
    } catch (error) {
        throw error
    }
}

async function openIssues() {
    try {
        core.info(`Opening issues`)
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (!repo.notified && !repo.issueNumber) {
                let issue
                try {
                    core.info(`Opening issue for ${repo.owner}/${repo.name}`)
                    const admins = repo.admins.concat(repo.adminTeamMembers)
                    issue = await octokit.issues.create({
                        owner: repo.owner,
                        repo: repo.name,
                        title: 'Notice: This repository has been marked for archival, please respond',
                        body: issueBody,
                        assignees: uniq(admins)
                    })
                } catch (error) {
                    core.info(`Unable to open issue in ${repo.owner}/${repo.name}: ${error.message}`)
                    continue
                }
                await db.setIssueNumber(repo.name, issue.data.number)
                await db.setLastNotified(repo.name, issue.data.created_at)
                await db.setNotified(repo.name, true)
            }
        }
    } catch (error) {
        throw error
    }
}

async function getAdmins(repo, orgAdmins) {
    try {
        core.info(`Updating repository admin information`)
        const adminTeamMembers = []
        const teams = await getTeams(repo.owner.login, repo.name)
        for (const team of teams) {
            if (team.permissions.admin || team.permissions.push) {
                core.info(`Identified the following team with push permission: ${team.slug}`)
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
                    core.info(`Identified the following collaborator with push permission: ${collaborator.login}`)
                    admins.push(collaborator.login)
                }
            }
        }
        core.info("Returning admins")
        return {
            admins: uniq(admins),
            adminTeamMembers: uniq(adminTeamMembers)
        }
    } catch (error) {
        throw error
    }
}

function uniq(array) {
    return [...new Set(array)]
}

let issueBody = `
Repository Admins and Contributors,

This repository has been identified as having been inactive for a period of time greater than ${_days} days. The policy of the ${_owner} organizations states that repositories without code contributions for ${_days} are subject to automated archival.

We recognize that some repositories may be inactive for various reasons, and being inactive due to lack of code contributions does not necessarily mean the repository itself is inactive.

Remember, archiving a repository does not delete the repository, it remains fully available to current users,  and can be unarchived at any time. Existing URL's will continue to work. Archiving a repository lets users know that this code is unmaintained, and its use should be vetted by users looking to consume it.

Repository admins and contributors with write access have 30 days to perform one of the following actions to allow this action to take place or to prevent their repository from archival:
- Add the \`archive\` label to this issue, which will cause this repository to be archived at the end of the 30 day waiting period
- Add the \`do-not-archive\` label to this issue, which will prevent this repository from being archived for ${_days} days, at which time the process will repeat itself
- Add the \`do-not-archive\` topic to this repository, this will prevent your repo from ever being flagged again
- Do nothing, and your repository will be automatically archived at the end of the 30 day waiting period
- Archive the repository yourself by navigating to \`settings\` and selecting the \`Archive this repository\` button at the bottom of the page

For questions or concerns please comment on this issue and tag the @${_owner}/${_adminTeam} in the comment. You can also reach the GitHub admin team directly via email at: ${_email}
`

if (_guidelines !== "") {
    issueBody += `

For information on the ${_owner} archival guidelines please see this page: ${_guidelines}
`
}

async function createLabels() {
    try {
        core.info(`Opening issues`)
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            console.log(`Adding labels to: ${repo.name}`)
            try {
                await octokit.issues.createLabel({
                    owner: repo.owner,
                    repo: repo.name,
                    name: 'do-not-archive',
                });
            } catch (e) {
                console.log(`Labels already exist`)
            }
            try {
                await octokit.issues.createLabel({
                    owner: repo.owner,
                    repo: repo.name,
                    name: 'archive',
                });
            } catch (e) {
                console.log(`Labels already exist`)
            }

        }
    } catch (e) {
        console.log(e)
    }

}

async function main() {
    try {
        await collect(_owner, _days)
        await enableIssues()
        await createLabels()
        await openIssues()
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
