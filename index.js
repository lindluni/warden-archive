const core = require('@actions/core')
const GitHubAuth = require('./lib/auth')
const Notify = require('./lib/notify')

const _token = core.getInput('token', {required: true})
const octokit = new GitHubAuth(_token).Client

async function notify() {
    const _owner = core.getInput('owner', {required: true})
    const _days = core.getInput('days', {required: true})
    const _guidelines = core.getInput('guidelines', {required: false})
    const _adminTeam = core.getInput('adminTeam', {required: true})
    const _email = core.getInput('adminEmail', {required: true})

    const app = new Notify(octokit, _owner, _days, _guidelines, _adminTeam, _email)
    await app.collect()
    await app.enableIssues()
    await app.createLabels()
    await app.openIssues()
}

async function main() {
    try {
        await notify()
    } catch (e) {
        core.setFailed(e.message)
    }
}

main()
