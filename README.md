# Repo Archival Tool

The `GitHub Repo Archival Tool` is an actions that automates the identification and notification of repositories that
their repository has been targeted for archival base on a set of predefined criteria. It will enable and open issues in
the repository, notify any user other than org admins
(unless explicitly granted access) that the repository has been flagged for archival, and will archive the repo after a
specified grace period unless the user acts.

You can configure the following options for this action:

```yaml
- name: Notify Contributors
  users: lindluni/archive-repos@v1
  with:
    action: notify
    days: 365
    owner: lindluni
    guidelines: https://lindluni-enterprise.github.io/github-handbook/archival-policy
    adminTeam: org-admins
    adminEmail: lindluni@nowhere.com
    token: ${{ github.token }}
```