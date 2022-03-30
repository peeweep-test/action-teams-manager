#!/usr/bin/env node

const core = require("@actions/core");
const github = require("@actions/github");
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const fs = require("fs");

const appOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: core.getInput("app_id", { required: true }),
    privateKey: core.getInput("private_key", { required: true }),
    installationId: core.getInput("installationId", { required: true }),
  },
});

owner = github.context.repo.owner;
repo = github.context.repo.repo;
org = owner;
teamYaml = core.getInput("config_file", { required: true });

(async function () {
  // parse yaml
  var teams = await parseYaml();
  // {"Team1":{"members":["peeweep"],"repositories_permissions":[{"Triage":[".github"]},{"Maintain":["test"]}]}}

  // get teams names
  teamsInOrg = await getTeamsInOrg();

  for (let team in teams) {
    // console.log("Team [%s] yaml info: \n%j", team, teams[team]);
    // Get Parent Team ID
    parent_team_name = teams[team].parent_team;

    var parent_team_id, privacy;
    privacy = "closed"; // "Visibility can't be secret for a parent or child team"

    if (parent_team_name) {
      // if parent_team not exist, create it and it has no member.
      if (teamsInOrg.indexOf(parent_team_name) < 0) {
        console.log(
          "Team [%s]'s parent team [%s] doesn't exist, create this team.",
          team,
          parent_team_name
        );
        const teamsCreate = await appOctokit.rest.teams.create({
          org,
          name: parent_team_name,
          privacy,
        });
        teamsInOrg.push(parent_team_name);
      }

      const {
        data: { id },
      } = await appOctokit.rest.teams.getByName({
        org,
        team_slug: parent_team_name,
      });
      parent_team_id = id;
    } else {
      parent_team_id = null;
    }

    // if team not exist, create it and it has no member.
    if (teamsInOrg.indexOf(team) < 0) {
      console.log("Team [%s] doesn't exist, create this team.", team);
      try {
        const teamsCreate = await appOctokit.rest.teams.create({
          org,
          name: team, // maintainers: teams[team].members,
          privacy,
        });
        teamsInOrg.push(team);

        if (parent_team_id) {
          // add parent_team_id on teams.create will create a pending request,
          // update team will add the child team directly
          const teamsUpdate = await appOctokit.rest.teams.updateInOrg({
            org,
            team_slug: team,
            parent_team_id,
          });
        }
      } catch (e) {
        throw e;
      }
    } else {
      // update team
      const teamsUpdate = await appOctokit.rest.teams.updateInOrg({
        org,
        team_slug: team,
        name: team,
        parent_team_id,
        privacy,
      });

      // console.log(teamsUpdate);
    }

    // update repo's permissions which managed by team
    await updateRepoPermissions(teams, team);

    // update members
    for (let username of teams[team].members) {
      const updateMembers =
        await appOctokit.rest.teams.addOrUpdateMembershipForUserInOrg({
          org,
          team_slug: team,
          username,
        });
      console.log("Team [%s] add member [%s]", team, username);
    }

    await updateProjectsPermissions(teams, team);
  }
})();

async function getTeamsInOrg() {
  try {
    teamsInOrg = [];
    const { data } = await appOctokit.rest.teams.list({
      org,
      per_page: 100,
    });

    for (let teamsListMember of data) {
      teamName = teamsListMember.name;
      teamsInOrg.push(teamName);
    }

    return teamsInOrg;
  } catch (e) {
    throw e;
  }
}

async function parseYaml() {
  const yaml = require("js-yaml");
  const fs = require("fs");

  let teams;
  try {
    teams = yaml.load(fs.readFileSync(teamYaml, "utf-8")).teams;

    return teams;
  } catch (e) {
    throw e;
  }
}

async function updateRepoPermissions(teams, team) {
  // update repo's permissions which managed by team
  // https://docs.github.com/en/rest/reference/teams#add-or-update-team-repository-permissions
  permissions = ["pull", "push", "admin", "maintain", "triage"];

  for (let repositories_permission of teams[team].repositories_permissions) {
    for (let permission of permissions) {
      if (repositories_permission[permission]) {
        for (let repo of repositories_permission[permission]) {
          const permissionUpdate =
            await appOctokit.rest.teams.addOrUpdateRepoPermissionsInOrg({
              org,
              team_slug: team,
              owner,
              repo,
              permission,
            });
          console.log(
            "Team [%s] update repo [%s]'s permission as %s",
            team,
            repo,
            permission
          );
        }
      }
    }
  }
}

async function updateProjectsPermissions(teams, team) {
  // get projects id
  const { data } = await appOctokit.rest.projects.listForOrg({
    org,
  });
  var projects = [];
  // [{"name":"project2","id":14309883},{"name":"project1","id":14314170}]
  for (let project of data) {
    var obj = { name: project.name, id: project.id };
    projects.push(obj);
  }

  // update repo's permissions which managed by team
  // https://docs.github.com/en/rest/reference/teams#add-or-update-team-repository-permissions
  permissions = ["read", "write", "admin"];

  // loop yaml for all permissions
  for (let projects_permission of teams[team].projects_permissions) {
    // get permission name by key
    permission = Object.keys(projects_permission)[0];
    for (let project_name of projects_permission[permission]) {
      function findProjectByName(project) {
        return project.name === project_name;
      }

      const { id: project_id } = projects.find(findProjectByName);

      const permissionUpdate =
        await appOctokit.rest.teams.addOrUpdateProjectPermissionsInOrg({
          org,
          team_slug: team,
          project_id,
          permission,
        });
      console.log(
        "Team [%s] update project [%s]'s permission as %s",
        team,
        project_name,
        permission
      );
    }
  }
}
