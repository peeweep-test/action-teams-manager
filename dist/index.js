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
  if (core.getInput("generate_yaml") === "true") {
    await generateYaml();
  }
  if (core.getInput("update_teams") === "true") {
    await updateTeams();
  }
})();

async function updateTeams() {
  console.log("Updating teams settings");
  // parse yaml
  var teams = await parseYaml();
  // {"Team1":{"members":["peeweep"],"repositories_permissions":[{"Triage":[".github"]},{"Maintain":["test"]}]}}

  // get teams names
  teamsInOrg = await getTeamsInOrg();

  for (let team of teams) {
    // console.log("Team [%s] yaml info: \n%j", team.name, team);
    // Get Parent Team ID
    parent_team_name = team.parent_team;

    var parent_team_id, privacy;
    privacy = "closed"; // "Visibility can't be secret for a parent or child team"

    if (parent_team_name) {
      // if parent_team not exist, create it and it has no member.
      if (teamsInOrg.indexOf(parent_team_name) < 0) {
        console.log(
          "Team [%s]'s parent team [%s] doesn't exist, create this team.",
          team.name,
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
    if (teamsInOrg.indexOf(team.name) < 0) {
      console.log("Team [%s] doesn't exist, create this team.", team.name);
      try {
        const teamsCreate = await appOctokit.rest.teams.create({
          org,
          name: team.name, // maintainers: team.members,
          privacy,
        });
        teamsInOrg.push(team.name);

        if (parent_team_id) {
          // add parent_team_id on teams.create will create a pending request,
          // update team will add the child team directly
          const teamsUpdate = await appOctokit.rest.teams.updateInOrg({
            org,
            team_slug: team.name,
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
        team_slug: team.name,
        name: team.name,
        parent_team_id,
        privacy,
      });

      // console.log(teamsUpdate);
    }

    // update repo's permissions which managed by team
    await updateRepoPermissions(team);

    // update members
    for (let username of team.members) {
      const updateMembers =
        await appOctokit.rest.teams.addOrUpdateMembershipForUserInOrg({
          org,
          team_slug: team.name,
          username,
        });
      console.log("Team [%s] add member [%s]", team.name, username);
    }

    await updateProjectsPermissions(team);
  }
}

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
  const yaml = require("yaml");
  const fs = require("fs");

  let teams;
  try {
    teams = yaml.parse(fs.readFileSync(teamYaml, "utf-8")).teams;

    return teams;
  } catch (e) {
    throw e;
  }
}

async function updateRepoPermissions(team) {
  if (!team.repositories_permissions) {
    return;
  }
  // update repo's permissions which managed by team
  // https://docs.github.com/en/rest/reference/teams#add-or-update-team-repository-permissions
  permissions = ["pull", "push", "admin", "maintain", "triage"];

  reposInOrgSet = await getReposInOrg();

  for (let [permission, repos] of Object.entries(
    team.repositories_permissions
  )) {
    // if wildcard matched, update repos
    if (repos.indexOf("*") > -1) {
      repos = reposInOrgSet;
    }

    for (let repo of repos) {
      const permissionUpdate =
        await appOctokit.rest.teams.addOrUpdateRepoPermissionsInOrg({
          org,
          team_slug: team.name,
          owner,
          repo,
          permission,
        });
      console.log(
        "Team [%s] update repo [%s]'s permission as %s",
        team.name,
        repo,
        permission
      );
    }
  }
}

async function getReposInOrg() {
  try {
    reposInOrg = [];
    lastPageLen = 100;
    page = 0;
    while (true) {
      page++;
      try {
        const { data } = await appOctokit.rest.repos.listForOrg({
          org,
          per_page: 100,
          page,
        });

        for (let reposListMember of data) {
          repoName = reposListMember.name;
          reposInOrg.push(repoName);
        }
        if (data.length < 100) {
          break;
        }
      } catch (e) {
        throw e;
      }
    }

    return reposInOrg;
  } catch (e) {
    throw e;
  }
}

async function updateProjectsPermissions(team) {
  if (!team.projects_permissions) {
    return;
  }

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
  for (const [permission, project_names] of Object.entries(
    team.projects_permissions
  )) {
    for (let project_name of project_names) {
      function findProjectByName(project) {
        return project.name === project_name;
      }

      const { id: project_id } = projects.find(findProjectByName);

      const permissionUpdate =
        await appOctokit.rest.teams.addOrUpdateProjectPermissionsInOrg({
          org,
          team_slug: team.name,
          project_id,
          permission,
        });
      console.log(
        "Team [%s] update project [%s]'s permission as %s",
        team.name,
        project_name,
        permission
      );
    }
  }
}

async function generateYaml() {
  console.log("Generating YAML, you can save it yourself if needed...");
  const { data: teamsListData } = await appOctokit.rest.teams.list({
    org,
    per_page: 100,
  });

  var teams = { teams: [] };
  for (let teamData of teamsListData) {
    // console.log(teamData);
    var team = {};
    team.name = teamData.name;

    // get parent team
    if (teamData.parent) {
      team.parent_team = teamData.parent.name;
    }

    // get members
    team.members = [];

    team_slug = teamData.slug;

    const { data: membersData } = await appOctokit.rest.teams.listMembersInOrg({
      org,
      team_slug,
    });
    for (let member of membersData) {
      team.members.push(member.login);
    }

    // get repositories permissions
    const { data: reposData } = await appOctokit.rest.teams.listReposInOrg({
      org,
      team_slug,
    });

    var repositories_permissions = {
      admin: [],
      maintain: [],
      push: [],
      triage: [],
      pull: [],
    };
    for (let repo of reposData) {
      // console.log(repo);
      reponame = repo.name;

      for (const [key, value] of Object.entries(repo.permissions)) {
        if (value) {
          // first permission is biggest
          // console.log(`team [${team.name}]: repo [${reponame}]'s permission is ${key}`);
          repositories_permissions[key].push(repo.name);
          break;
        }
      }
    }
    // clean empty permissions
    for (const [key, value] of Object.entries(repositories_permissions)) {
      if (repositories_permissions[key].length === 0) {
        delete repositories_permissions[key];
      }
    }

    team.repositories_permissions = repositories_permissions;

    // get projects permissions
    var projects_permissions = { read: [], write: [], admin: [] };
    const { data: projctsData } = await appOctokit.rest.teams.listProjectsInOrg(
      {
        org,
        team_slug,
      }
    );

    for (let project of projctsData) {
      for (const [key, value] of Object.entries(project.permissions)) {
        if (value) {
          projects_permissions[key].push(project.name);
        }
      }
    }

    // clean empty permissions
    for (const [key, value] of Object.entries(projects_permissions)) {
      if (projects_permissions[key].length === 0) {
        delete projects_permissions[key];
      }
    }

    team.projects_permissions = projects_permissions;

    // clean empty objects

    for (const [key, value] of Object.entries(team)) {
      if (Object.keys(team[key]).length === 0) {
        delete team[key];
      }
    }

    teams["teams"].push(team);
  }

  const YAML = require("yaml");
  const doc = new YAML.Document();
  doc.contents = teams;

  console.log(doc.toString());
  // console.log("%j", teams);
}
