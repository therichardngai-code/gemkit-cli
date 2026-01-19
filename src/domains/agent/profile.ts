/**
 * Agent profile loading
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { AgentProfile, CliProvider } from './types.js';
import { getAgentsDir } from '../../utils/paths.js';
import { getAgentPaths, mapModel, mapTools } from './mappings.js';

/**
 * Load a single agent profile by name
 */
export function loadAgentProfile(name: string, projectDir?: string): AgentProfile | null {
  const agentsDir = getAgentsDir(projectDir);
  const filePath = join(agentsDir, `${name}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return parseAgentProfile(filePath);
}

/**
 * List all available agent profiles
 */
export function listAgentProfiles(projectDir?: string): AgentProfile[] {
  const agentsDir = getAgentsDir(projectDir);

  if (!existsSync(agentsDir)) {
    return [];
  }

  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  const profiles: AgentProfile[] = [];

  for (const file of files) {
    const filePath = join(agentsDir, file);
    const profile = parseAgentProfile(filePath);
    if (profile) {
      profiles.push(profile);
    }
  }

  return profiles;
}

/**
 * Parse YAML frontmatter from markdown
 */
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fm: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return fm;
}

/**
 * Parse skills - handles single/multiple/array formats:
 * - "research" -> ["research"]
 * - "skill1, skill2" -> ["skill1", "skill2"]
 * - "[skill1, skill2]" -> ["skill1", "skill2"]
 */
function parseSkills(value: string | undefined): string[] {
  if (!value) return [];
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

/**
 * Parse tools - handles single/multiple/array formats:
 * - "read_file" -> ["read_file"]
 * - "tool1, tool2" -> ["tool1", "tool2"]
 * - "[tool1, tool2]" -> ["tool1", "tool2"]
 */
function parseTools(value: string | undefined): string[] {
  if (!value) return [];
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

/**
 * Parse agent profile from markdown file
 */
function parseAgentProfile(filePath: string): AgentProfile | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  const name = basename(filePath, '.md');

  let description = '';
  let model = 'gemini-2.5-flash';
  let skills: string[] = [];
  let tools: string[] = [];

  // Parse YAML frontmatter
  const fm = parseFrontmatter(content);
  let cleanContent = content;

  if (fm) {
    if (fm.description) description = fm.description;
    if (fm.model) model = fm.model;
    skills = parseSkills(fm.skills);
    tools = parseTools(fm.tools);
    // Strip frontmatter from content to avoid duplication
    cleanContent = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  } else {
    // Fallback: parse from content body
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        description = line.substring(2).trim();
        break;
      }
      if (line.trim() && !line.startsWith('#')) {
        description = line.trim();
        break;
      }
    }

    const modelMatch = content.match(/model:\s*(.+)/i);
    if (modelMatch) model = modelMatch[1].trim();

    const skillsMatch = content.match(/skills:\s*(.+)/i);
    if (skillsMatch) skills = parseSkills(skillsMatch[1]);

    const toolsMatch = content.match(/tools:\s*(.+)/i);
    if (toolsMatch) tools = parseTools(toolsMatch[1]);
  }

  return {
    name,
    description,
    model,
    skills,
    tools,
    content: cleanContent,
    filePath,
  };
}

/**
 * Get agent profile details as formatted string
 */
export function formatAgentProfile(profile: AgentProfile): string {
  let output = `Agent: ${profile.name}\n`;
  output += `Description: ${profile.description}\n`;
  output += `Model: ${profile.model}\n`;
  if (profile.skills && profile.skills.length > 0) {
    output += `Skills: ${profile.skills.join(', ')}\n`;
  }
  if (profile.tools && profile.tools.length > 0) {
    output += `Tools: ${profile.tools.join(', ')}\n`;
  }
  output += `Path: ${profile.filePath}\n`;
  return output;
}

/**
 * Load agent profile with fallback between providers
 * Tries primary provider's folder first, then falls back to the other provider's folder
 * Maps model and tools to target provider when using fallback
 */
export function loadAgentProfileWithFallback(
  name: string,
  targetProvider: CliProvider,
  projectDir?: string
): AgentProfile | null {
  const cwd = projectDir || process.cwd();
  const agentPaths = getAgentPaths(targetProvider);

  for (const relPath of agentPaths) {
    const filePath = join(cwd, relPath, `${name}.md`);
    if (existsSync(filePath)) {
      const profile = parseAgentProfile(filePath);
      if (profile) {
        // Check if this is from the fallback path (not the primary)
        const isPrimaryPath = relPath === agentPaths[0];
        if (!isPrimaryPath) {
          // Map model and tools to target provider
          profile.model = mapModel(profile.model, targetProvider);
          if (profile.tools && profile.tools.length > 0) {
            profile.tools = mapTools(profile.tools, targetProvider);
          }
        }
        return profile;
      }
    }
  }

  return null;
}

/**
 * List all available agent profiles with fallback between providers
 */
export function listAgentProfilesWithFallback(
  targetProvider: CliProvider,
  projectDir?: string
): AgentProfile[] {
  const cwd = projectDir || process.cwd();
  const agentPaths = getAgentPaths(targetProvider);
  const profiles: AgentProfile[] = [];
  const seenNames = new Set<string>();

  for (const relPath of agentPaths) {
    const agentsDir = join(cwd, relPath);
    if (!existsSync(agentsDir)) continue;

    const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    const isPrimaryPath = relPath === agentPaths[0];

    for (const file of files) {
      const name = basename(file, '.md');
      // Skip if already found in primary path
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const filePath = join(agentsDir, file);
      const profile = parseAgentProfile(filePath);
      if (profile) {
        if (!isPrimaryPath) {
          // Map model and tools to target provider
          profile.model = mapModel(profile.model, targetProvider);
          if (profile.tools && profile.tools.length > 0) {
            profile.tools = mapTools(profile.tools, targetProvider);
          }
        }
        profiles.push(profile);
      }
    }
  }

  return profiles;
}
