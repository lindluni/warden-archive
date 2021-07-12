const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({repos: {}}).write()

exports.addRepo = async (repo, data) => {
    await db.set(`repos.${sanitize(repo)}`, data).write()
}

exports.scanned = async (repo) => {
    return await db.get(`repos.${sanitize(repo)}`).value()
}

exports.getRepos = async () => {
    return await db.get('repos').value()
}

exports.getLastNotified = async (repo) => {
    return await db.get(`repos.${sanitize(repo)}.lastNotified`).value()
}

exports.setLastNotified = async (repo, lastNotified) => {
    await db.set(`repos.${sanitize(repo)}.lastNotified`, lastNotified).write()
}

exports.setAdmins = async (repo, admins) => {
    await db.set(`repos.${sanitize(repo)}.admins`, admins).write()
}

exports.setTeamMembers = async (repo, adminTeamMembers) => {
    await db.set(`repos.${sanitize(repo)}.adminTeamMembers`, adminTeamMembers).write()
}

exports.setNotified = async (repo, notified) => {
    await db.set(`repos.${sanitize(repo)}.notified`, notified).write()
}

exports.setLastScanned = async (repo, lastScanned) => {
    await db.set(`repos.${sanitize(repo)}.lastScanned`, lastScanned).write()
}

exports.setIssuesEnabled = async (repo) => {
    await db.set(`repos.${sanitize(repo)}.hasIssues`, true).write()
}

exports.setIssueNumber = async (repo, number) => {
    await db.set(`repos.${sanitize(repo)}.issueNumber`, number).write()
}

function sanitize(data) {
    return data.replace(/\./g, '~')
}