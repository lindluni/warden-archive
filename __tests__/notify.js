jest.mock('@actions/github')

const github = require('@actions/github')
const Notify = require('../lib/notify')

describe('It notifies repository admins', () => {
    let octokit
    let app

    beforeEach(() => {
        octokit = new github.getOctokit('token')
        app = new Notify(octokit, "", "", "", "", "")
    })

    describe('by retrieving user information', () => {
        test('by getting organization admins', async () => {
            const expected = [
                'fake-admin-1',
                'fake-admin-2'
            ]
            const owners = await app.getOrgOwners('test')
            expect(octokit.paginate).toBeCalledTimes(1)
            expect(octokit.orgs.listMembers).toBeCalledTimes(1)
            expect(owners).toEqual(expected)
        })
        test('by retrieving repository teams', async () => {
            const expected = [
                {slug: 'fake-team-1', permissions: {push: true, admin: true}},
                {slug: 'fake-team-2', permissions: {push: true, admin: false}},
                {slug: 'fake-team-3', permissions: {push: false, admin: true}},
                {slug: 'fake-team-4', permissions: {push: false, admin: false}}
            ]
            const teams = await app.getTeams('', '')
            expect(octokit.paginate).toBeCalledTimes(2)
            expect(octokit.repos.listTeams).toBeCalledTimes(1)
            expect(teams).toEqual(expected)
        })
        test('by retrieving repository team members', async () => {
            const expected = [
                'fake-user-1',
                'fake-user-2'
            ]
            const teamMembers = await app.getTeamMembers('', '')
            expect(octokit.paginate).toBeCalledTimes(3)
            expect(octokit.repos.listTeams).toBeCalledTimes(1)
            expect(teamMembers).toEqual(expected)
        })
    })
})

github.getOctokit = jest.fn().mockReturnValue({
    paginate: jest.fn().mockImplementation(octokitFn => {
        return octokitFn()
    }),
    orgs: {
        listMembers: jest.fn().mockImplementation(() => {
            return [
                {login: 'fake-admin-1'},
                {login: 'fake-admin-2'}
            ]
        })
    },
    repos: {
        listTeams: jest.fn().mockImplementation(() => {
            return [
                {slug: 'fake-team-1', permissions: {push: true, admin: true}},
                {slug: 'fake-team-2', permissions: {push: true, admin: false}},
                {slug: 'fake-team-3', permissions: {push: false, admin: true}},
                {slug: 'fake-team-4', permissions: {push: false, admin: false}}
            ]
        }),
        listCollaborators: jest.fn().mockImplementation(() => {
            return [
                {login: 'fake-collaborator-1', permissions: {push: true, admin: true}},
                {login: 'fake-collaborator-2', permissions: {push: true, admin: false}},
                {login: 'fake-collaborator-3', permissions: {push: false, admin: true}},
                {login: 'fake-collaborator-4', permissions: {push: false, admin: false}}
            ]
        }),
    },
    teams: {
        listMembersInOrg: jest.fn().mockImplementation(() => {
            return [
                {login: 'fake-user-1'},
                {login: 'fake-user-2'}
            ]
        }),
    }
})