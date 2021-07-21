const core = require('@actions/core')
const GitHubAuth = require('./lib/auth')
const Archiver = require('./lib/archive')
const Notifier = require('./lib/notify')

const _token = core.getInput('token', {required: true})
const octokit = new GitHubAuth(_token).Client

async function notify() {
    const _owner = core.getInput('owner', {required: true})
    const _days = core.getInput('days', {required: true})
    const _guidelines = core.getInput('guidelines', {required: false})
    const _adminTeam = core.getInput('adminTeam', {required: true})
    const _email = core.getInput('adminEmail', {required: true})

    // const notifier = new Notifier(octokit, _owner, _days, _guidelines, _adminTeam, _email)
    // await notifier.collect()
    // await notifier.enableIssues()
    // await notifier.createLabels()
    // await notifier.openIssues()

    const archiver = new Archiver(octokit, _days)
    await archiver.archive()
}

async function main() {
    try {
        await notify()
    } catch (e) {
        core.setFailed(e.message)
    }
}

main()
