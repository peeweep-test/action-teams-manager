# action-teams-manager

github actions for teams manage

## Features

1. Create team if not exist
2. Set parent team
3. Add member
4. Manage repositories and set permission
5. Manage projects and set permission

## Input

```yaml
inputs:
  app_id:
    description: "github app id"
    required: true
  installationId:
    description: "github app installationId"
    required: true
  private_key:
    description: "github app private key"
    required: true
  config_file:
    description: "manager config file"
    required: true
```

## Uses

1. Create and Install GitHub App in organization settings
1. Get AppID (App setting -> General) and InstallationID (App setting -> Advanced -> Recent Deliveries -> Payload)
1. Generate GitHub App Private Key and upload to organization secrets
1. Add `.github/workflows/teams-manager.yml` to organization repository

```yaml
name: teams-manager
on:
  push:
    paths:
      - ".github/workflows/teams-manager.yml"
      - "teams.yaml"
  workflow_dispatch:

jobs:
  update-teams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: update teams
        uses: linuxdeepin/action-teams-manager@master
        with:
          app_id: $app_id
          installationId: $installation_id
          private_key: ${{ secrets.APP_PRIVATE_KEY }}
          config_file: teams.yaml
```

1. Add `teams.yaml` config file to repository

```yaml
teams:
  Team1: # team name
    parent_team: "ParentTeam1" # parent team name
    members: # team members
      - member1 # member username
      - member2 # member username
    repositories_permissions:
      # permissions = ["pull", "push", "admin", "maintain", "triage"];
      - triage:
          - repository1 # repository name
      - maintain:
          - repository2 # repository name
    projects_permissions:
      # permissions = ["read", "write", "admin"];
      - admin:
          - project1 # project name
          - project2
      - read:
          - project2
```
