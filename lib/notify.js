const core = require('@actions/core')
const db = require('./database')

class Notify {
    constructor(client, owner, days, guidelines, adminTeam, email) {
        this.octokit = client
        this.owner = owner
        this.days = days
        this.guidelines = guidelines
        this.adminTeam = adminTeam
        this.email = email
        this.issueBody = `
Repository Admins and Contributors,

This repository has been identified as having been inactive for a period of time greater than ${this.days} days. The policy of the ${this.owner} organizations states that repositories without code contributions for ${this.days} are subject to automated archival.

We recognize that some repositories may be inactive for various reasons, and being inactive due to lack of code contributions does not necessarily mean the repository itself is inactive.

Remember, archiving a repository does not delete the repository, it remains fully available to current users,  and can be unarchived at any time. Existing URL's will continue to work. Archiving a repository lets users know that this code is unmaintained, and its use should be vetted by users looking to consume it.

Repository admins and contributors with write access have 30 days to perform one of the following actions to allow this action to take place or to prevent their repository from archival:
- Add the \`archive\` label to this issue, which will cause this repository to be archived at the end of the 30 day waiting period
- Add the \`do-not-archive\` label to this issue, which will prevent this repository from being archived for ${this.days} days, at which time the process will repeat itself
- Add the \`do-not-archive\` topic to this repository, this will prevent your repo from ever being flagged again
- Do nothing, and your repository will be automatically archived at the end of the 30 day waiting period
- Archive the repository yourself by navigating to \`settings\` and selecting the \`Archive this repository\` button at the bottom of the page

For questions or concerns please comment on this issue and tag the @${this.owner}/${this.adminTeam} in the comment. You can also reach the GitHub admin team directly via email at: ${this.email}
`

        if (this.guidelines !== "") {
            this.issueBody += `

For information on the ${this.owner} archival guidelines please see this page: ${this.guidelines}
`
        }
    }

    async collect() {
        try {
            core.info(`Querying repositories for organization: ${this.owner}`)
            const repos = await this.octokit.paginate(this.octokit.repos.listForOrg, {
                org: this.owner,
                per_page: 100,
                type: 'all'
            })
            core.info(`Found ${repos.length} repos`)

            const backdate = new Date()
            backdate.setDate(backdate.getDate() - this.days)

            const orgAdmins = await this.getOrgOwners(this.owner)
            for (const repo of repos) {
                try {
                    const _lastNotified = await db.getLastNotified(repo.name)
                    const lastNotified = new Date(_lastNotified)
                    const lastPushed = new Date(repo.pushed_at)
                    const scanned = await db.scanned(repo.name)
                    if (!scanned && !repo.archived && lastPushed < backdate) {
                        const topics = await this.octokit.repos.getAllTopics({
                            owner: repo.owner.login,
                            repo: repo.name,
                            per_page: 100
                        })
                        if (topics.data.names.includes('do-not-archive')) {
                            core.info(`${repo.name} is marked 'do-not-archive', skipping scan`)
                        }
                        core.info(`Scanning dormant repository: ${repo.name}`)
                        const admins = await this.getAdmins(repo, orgAdmins)
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

                        const admins = await this.getAdmins(repo, orgAdmins)
                        await db.setAdmins(repo.name, admins.admins)
                        await db.setTeamMembers(repo.name, admins.adminTeamMembers)
                    } else {
                        core.info(`Skipping non-dormant repository: ${repo.name}`)
                    }
                } catch (e) {
                    core.warning(`Unable to scan repository ${repo.owner.login}/${repo.name}: ${e.message}`)
                }
            }
        } catch (e) {
            throw new Error(`Failed querying repos: ${e.message}`)
        }
    }

    async getOrgOwners(org) {
        core.info('Query organization admins')
        const admins = await this.octokit.paginate(this.octokit.orgs.listMembers, {
            org: org,
            role: 'admin',
            per_page: 100
        })
        return admins.map(admin => admin.login)
    }

    async getTeams(owner, repo) {
        core.info('Querying repository teams')
        return await this.octokit.paginate(this.octokit.repos.listTeams, {
            owner: owner,
            repo: repo,
            per_page: 100
        })
    }

    async getTeamMembers(org, slug) {
        core.info('Querying team members')
        const teamMembers = await this.octokit.paginate(this.octokit.teams.listMembersInOrg, {
            org: org,
            team_slug: slug,
            role: 'all',
            per_page: 100
        })
        return teamMembers.map(member => member.login)
    }

    async getCollaborators(owner, repo) {
        core.info('Querying repository collaborators')
        return await this.octokit.paginate(this.octokit.rest.repos.listCollaborators, {
            owner: owner,
            repo: repo,
            per_page: 100
        })
    }

    async enableIssues() {
        core.info('Enabling issues')
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (!repo.hasIssues) {
                core.info(`Enabling issues for ${repo.name}`)
                await this.octokit.repos.update({
                    owner: repo.owner,
                    repo: repo.name,
                    has_issues: true
                })
                await db.setIssuesEnabled(repo.name)
            }
        }
    }

    async openIssues() {
        core.info(`Opening issues`)
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (!repo.notified && !repo.issueNumber) {
                let issue
                try {
                    core.info(`Opening issue for ${repo.owner}/${repo.name}`)
                    const admins = repo.admins.concat(repo.adminTeamMembers)
                    issue = await this.octokit.issues.create({
                        owner: repo.owner,
                        repo: repo.name,
                        title: 'Notice: This repository has been marked for archival, please respond',
                        body: this.issueBody,
                        assignees: this.uniq(admins)
                    })
                } catch (e) {
                    core.info(`Unable to open issue in ${repo.owner}/${repo.name}: ${e.message}`)
                    continue
                }
                await db.setIssueNumber(repo.name, issue.data.number)
                await db.setLastNotified(repo.name, issue.data.created_at)
                await db.setNotified(repo.name, true)
            }
        }
    }

    async getAdmins(repo, orgAdmins) {
        core.info(`Updating repository admin information`)
        const adminTeamMembers = []
        const teams = await this.getTeams(repo.owner.login, repo.name)
        for (const team of teams) {
            if (team.permissions.admin || team.permissions.push) {
                core.info(`Identified the following team with push permission: ${team.slug}`)
                const members = await this.getTeamMembers(repo.owner.login, team.slug)
                adminTeamMembers.push(...members)
            }
        }
        const admins = []
        const collaborators = await this.getCollaborators(repo.owner.login, repo.name)
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
            admins: this.uniq(admins),
            adminTeamMembers: this.uniq(adminTeamMembers)
        }
    }

    uniq(array) {
        return [...new Set(array)]
    }

    async createLabels() {
        core.info(`Adding labels`)
        const repos = await db.getRepos()
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            core.info(`Querying labels for ${repo.name}`)
            const _labels = await this.octokit.paginate(this.octokit.issues.listLabelsForRepo, {
                owner: repo.owner,
                repo: repo.name,
                per_page: 100
            })
            const labels = _labels.map(label => label.name)
            if (!labels.includes('do-not-archive')) {
                console.log(`Adding 'do-not-archive' label to: ${repo.name}`)
                try {
                    await this.octokit.issues.createLabel({
                        owner: repo.owner,
                        repo: repo.name,
                        name: 'do-not-archive',
                    })
                } catch (e) {
                    core.warning(`Unable to add 'do-not-archive' label: ${e.message}`)
                }
            }
            if (!labels.includes('archive')) {
                console.log(`Adding 'archive' label to: ${repo.name}`)
                try {
                    await this.octokit.issues.createLabel({
                        owner: repo.owner,
                        repo: repo.name,
                        name: 'archive',
                    });
                } catch (e) {
                    core.warning(`Unable to add 'archive' label: ${e.message}`)
                }
            }
        }
    }
}

module.exports = Notify