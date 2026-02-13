/**
 * Team Member Spawn - Spawns sub-agents with team context
 * Integrates with existing agent spawn infrastructure
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { loadAgentProfileWithFallback } from '../agent/profile.js';
import { searchAgentSkillCombination, loadSkillContent } from '../agent/search.js';
import { mapModel, mapTools } from '../agent/mappings.js';
import type { CliProvider } from '../agent/types.js';
import { GkTeam, TeamMember } from './types.js';
import { addMemberToTeam, updateMemberStatus } from './writer.js';
import { allocatePort, releasePort, updatePortPid } from './port-manager.js';
import { generateGkSessionId } from '../../services/hash.js';
import { readEnv } from '../session/env.js';
import { addAgent } from '../session/writer.js';

export interface SpawnMemberOptions {
  team: GkTeam;
  projectDir: string;
  name: string;                    // Human-readable name (e.g., "researcher")
  agentType: string;               // Agent profile name
  prompt: string;                  // Task prompt
  skills?: string[];               // Additional skills to inject
  model?: string;                  // Model override
  tools?: string[];                // Tools to allow
  cliProvider?: CliProvider;       // 'gemini' or 'claude'
}

export interface SpawnMemberResult {
  success: boolean;
  member?: TeamMember;
  agentId?: string;
  port?: number;
  pid?: number;
  error?: string;
}

/**
 * Build team context string for prompt injection
 */
function buildTeamContext(team: GkTeam, memberName: string): string {
  const lines = [
    `# Team Context`,
    `Team: ${team.teamName}`,
    `Team ID: ${team.teamId}`,
    `Your Name: ${memberName}`,
    `Your Role: member`,
    `Leader: leader (port ${team.leaderPort})`,
    ``,
    `## Team Members`,
  ];

  for (const member of team.members) {
    const status = member.status === 'ready' ? '🟢' : '⚪';
    lines.push(`- ${status} ${member.name} (${member.role}) - port ${member.port}`);
  }

  lines.push('');
  lines.push('## Communication');
  lines.push('Use SendMessage tool to communicate with teammates.');
  lines.push('Use TaskList/TaskUpdate to manage tasks.');
  lines.push('Check messages regularly for team updates.');

  return lines.join('\n');
}

/**
 * Spawn a team member sub-agent
 */
export async function spawnTeamMember(options: SpawnMemberOptions): Promise<SpawnMemberResult> {
  const {
    team,
    projectDir,
    name,
    agentType,
    prompt,
    skills = [],
    model: modelOverride,
    tools = [],
    cliProvider = 'gemini'
  } = options;

  // Generate agent session ID
  const agentId = generateGkSessionId(`team-${name}`, process.pid);

  // Allocate port for member
  const port = allocatePort(projectDir, agentId, team.teamId, null);
  if (!port) {
    return {
      success: false,
      error: 'No ports available for new team member'
    };
  }

  // Load agent profile with fallback
  const profile = agentType ? loadAgentProfileWithFallback(agentType, cliProvider) : null;

  // Determine model
  let model = modelOverride || profile?.model || 'gemini-2.5-pro';
  model = mapModel(model, cliProvider);

  // Build skills list
  const allSkills = [...new Set([...(profile?.skills || []), ...skills])];

  // Build tools list
  const mergedTools = [...new Set([...(profile?.tools || []), ...tools])];
  const allTools = mapTools(mergedTools, cliProvider);

  // Build enriched prompt
  const promptParts: string[] = [];

  // Add team context
  promptParts.push('<team-context>');
  promptParts.push(buildTeamContext(team, name));
  promptParts.push('</team-context>\n');

  // Add task
  promptParts.push('<task>');
  promptParts.push(prompt);
  promptParts.push('</task>\n');

  // Add agent profile content
  if (profile) {
    promptParts.push('<agent>');
    promptParts.push(`# Agent: ${profile.name}\n`);
    promptParts.push('## Role & Responsibilities');
    promptParts.push(profile.content);
    promptParts.push('</agent>\n');
  }

  // Add skills content
  if (allSkills.length > 0) {
    promptParts.push('<skills>');
    promptParts.push('You have access to the following skills:\n');

    for (let i = 0; i < allSkills.length; i++) {
      const skill = allSkills[i];
      const skillContent = loadSkillContent(skill);
      if (skillContent) {
        promptParts.push(`## Skill ${i + 1}: ${skill}`);
        promptParts.push(skillContent);
        promptParts.push('---\n');
      }
    }
    promptParts.push('</skills>\n');
  }

  const enrichedPrompt = promptParts.join('\n');

  // Read existing env for parent session info
  const env = readEnv();
  const parentGkSessionId = env.ACTIVE_GK_SESSION_ID || team.leaderId;

  // Add member to team BEFORE spawning (so team knows about it)
  const memberAdded = addMemberToTeam(projectDir, team.teamId, {
    agentId,
    name,
    agentType: agentType || 'default',
    role: 'member',
    port,
    pid: null,
    status: 'starting'
  });

  if (!memberAdded) {
    releasePort(projectDir, agentId);
    return {
      success: false,
      error: 'Failed to register member in team'
    };
  }

  // Build spawn environment
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // GemKit identifiers
    GK_TEAM_ID: team.teamId,
    GK_TEAM_NAME: team.teamName,
    GK_TEAM_ROLE: 'member',
    GK_TEAM_PORT: port.toString(),
    GK_TEAM_LEADER_PORT: team.leaderPort.toString(),
    GK_AGENT_NAME: name,
    GK_PARENT_SESSION_ID: parentGkSessionId,
    GK_SUB_SESSION_ID: agentId,
    // Provider-specific
    ...(cliProvider === 'claude' ? {
      CLAUDE_TYPE: 'team-member',
      CLAUDE_AGENT_ROLE: name,
      CLAUDE_AGENT_MODEL: model,
    } : {
      GEMINI_TYPE: 'team-member',
      GEMINI_AGENT_ROLE: name,
      GEMINI_AGENT_MODEL: model,
    })
  };

  // Build spawn args
  let cliCommand: string;
  let spawnArgs: string[];

  if (cliProvider === 'claude') {
    cliCommand = 'claude';
    spawnArgs = ['-p', '--model', model];
    if (allTools.length > 0) {
      spawnArgs.push('--allowedTools', allTools.join(','));
    }
  } else {
    cliCommand = 'gemini';
    spawnArgs = ['-m', model];
    if (allTools.length > 0) {
      spawnArgs.push('--allowed-tools', JSON.stringify(allTools));
    }
  }

  return new Promise((resolve) => {
    const child = spawn(cliCommand, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: spawnEnv,
      detached: false  // Keep attached to parent for now
    });

    // Update PID in port allocation
    if (child.pid) {
      updatePortPid(projectDir, agentId, child.pid);
      updateMemberStatus(projectDir, team.teamId, agentId, 'ready');
    }

    // Send prompt
    child.stdin.write(enrichedPrompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // Mark member as shutdown
      updateMemberStatus(projectDir, team.teamId, agentId, 'shutdown');
      releasePort(projectDir, agentId);

      if (code === 0) {
        resolve({
          success: true,
          member: {
            agentId,
            name,
            agentType: agentType || 'default',
            role: 'member',
            port,
            pid: child.pid || null,
            status: 'shutdown',
            joinedAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString()
          },
          agentId,
          port,
          pid: child.pid
        });
      } else {
        resolve({
          success: false,
          error: stderr || `Agent exited with code ${code}`
        });
      }
    });

    child.on('error', (err) => {
      updateMemberStatus(projectDir, team.teamId, agentId, 'shutdown');
      releasePort(projectDir, agentId);
      resolve({
        success: false,
        error: `Failed to spawn: ${err.message}`
      });
    });

    // Return immediately with spawn info (non-blocking)
    // The promise above handles completion
    setTimeout(() => {
      if (child.pid) {
        resolve({
          success: true,
          member: {
            agentId,
            name,
            agentType: agentType || 'default',
            role: 'member',
            port,
            pid: child.pid,
            status: 'ready',
            joinedAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString()
          },
          agentId,
          port,
          pid: child.pid
        });
      }
    }, 2000);  // Give process 2s to start
  });
}

/**
 * Spawn team member using best agent for task
 */
export async function spawnBestAgentForTask(
  team: GkTeam,
  projectDir: string,
  memberName: string,
  task: string,
  cliProvider: CliProvider = 'gemini'
): Promise<SpawnMemberResult> {
  // Search for best agent+skills combination
  const results = searchAgentSkillCombination(task, { top: 1 });

  if (results.length === 0) {
    // Fall back to default spawn
    return spawnTeamMember({
      team,
      projectDir,
      name: memberName,
      agentType: 'default',
      prompt: task,
      cliProvider
    });
  }

  const best = results[0];

  return spawnTeamMember({
    team,
    projectDir,
    name: memberName,
    agentType: best.agent,
    prompt: task,
    skills: best.skills,
    cliProvider
  });
}
