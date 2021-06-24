const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({repos: {}}).write()

exports.addRepo = async (repo, data) => {
    try {
        await db.set(`repos.${sanitize(repo)}`, data).write()
    } catch (e) {
        throw e
    }
}

exports.scanned = async (repo) => {
    try {
        return await db.get(`repos.${sanitize(repo)}`).value()
    } catch (e) {
        throw e
    }
}

exports.setIssuesEnabled = async (repo) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.has_issues`, true).write()
    } catch (e) {
        throw e
    }
}

exports.setIssueNumber = async (repo, number) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.issueNumber`, number).write()
    } catch (e) {
        throw e
    }
}

exports.getLastNotified = async (repo) => {
    try {
        return await db.get(`repos.${sanitize(repo)}.lastNotified`).value()
    } catch (e) {
        throw e
    }
}

exports.setLastNotified = async (repo, lastNotified) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.lastNotified`, lastNotified).write()
    } catch (e) {
        throw e
    }
}

exports.setAdmins = async (repo, admins) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.admins`, admins).write()
    } catch (e) {
        throw e
    }
}

exports.setTeamMembers = async (repo, adminTeamMembers) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.adminTeamMembers`, adminTeamMembers).write()
    } catch (e) {
        throw e
    }
}

exports.setNotified = async (repo, notified) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.notified`, notified).write()
    } catch (e) {
        throw e
    }
}

exports.setLastScanned = async (repo, lastScanned) => {
    try {
        return await db.set(`repos.${sanitize(repo)}.lastScanned`, lastScanned).write()
    } catch (e) {
        throw e
    }
}


exports.getRepos = async () => {
    try {
        return await db.get('repos').value()
    } catch (e) {
        throw e
    }
}

function sanitize(data) {
    return data.replace(/\./g, '~')
}