const core = require('@actions/core')
const db = require('./database')

class Archiver {
    constructor(client, days) {
        this.octokit = client
        this.days = days
    }

    async process() {
        const repos = await db.getRepos()
        const backdate = new Date()
        backdate.setDate(backdate.getDate() - this.days)
        for (const _repo of Object.keys(repos)) {
            const repo = repos[_repo]
            if (repo.notified) {
                const lastNotified = new Date(repo.lastNotified)
                if (lastNotified < backdate) {
                    try {
                        const doNotArchive = await this.doNotArchiveLabelsExist(repo)
                        if (!doNotArchive) {
                            await this.archive(repo)
                        }
                    } catch (e) {
                        core.warning(`Error evaluating the archival of ${repo.owner}/${repo.name}: ${e.message}`)
                    }
                }
            }
        }
    }

    async doNotArchiveLabelsExist(repo) {
        const topics = await this.octokit.repos.getAllTopics({
            owner: repo.owner,
            repo: repo.name,
            per_page: 100
        })
        if (topics.data.names.includes('do-not-archive')) {
            core.info(`${repo.name} is marked 'do-not-archive', skipping archive`)
            return true
        }

        const issue = await this.octokit.issues.get({
            owner: repo.owner,
            repo: repo.name,
            issue_number: repo.issueNumber
        })
        if (issue.data.labels.includes('do-not-archive')) {
            core.info(`Issue has the 'do-not-archive' label, skipping archival`)
            return true
        }
        return false
    }

    async archive(repo) {
        core.info(`Archiving repo ${repo.name}`)
        await this.octokit.repos.update({
            owner: repo.owner,
            repo: repo.name,
            archived: true
        })
        core.info(`${repo.name} archived`)

        core.info(`Closing issue #${repo.issueNumber} for ${repo.name}`)
        await this.octokit.issues.update({
            owner: repo.owner,
            repo: repo.name,
            issue_number: repo.issueNumber,
            state: 'closed'
        })
        core.info(`Issue #${repo.issueNumber} has been closed for ${repo.name}`)
    }
}

module.exports = Archiver
