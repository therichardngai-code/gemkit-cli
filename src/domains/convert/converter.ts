/**
 * Skill to Extension Converter
 * Converts .claude/skills to .gemini/extensions
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import {
  SkillFrontmatter,
  GeminiExtension,
  SkillInfo,
  ConversionResult,
  ConvertOptions,
  AgentFrontmatter,
  AgentInfo,
  MODEL_MAPPING
} from './types.js';

// Default paths
const CLAUDE_SKILLS_DIR = '.claude/skills';
const GEMINI_EXTENSIONS_DIR = '.gemini/extensions';
const CLAUDE_AGENTS_DIR = '.claude/agents';
const GEMINI_AGENTS_DIR = '.gemini/agents';

/**
 * Parse YAML-like frontmatter from markdown file
 */
export function parseFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const frontmatter: SkillFrontmatter = { name: '', description: '' };
  const lines = match[1].split(/\r?\n/);

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return frontmatter;
}

/**
 * Get skills directory path
 */
export function getSkillsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, CLAUDE_SKILLS_DIR);
}

/**
 * Get extensions directory path
 */
export function getExtensionsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, GEMINI_EXTENSIONS_DIR);
}

/**
 * List all available Claude skills
 */
export function listSkills(projectDir: string = process.cwd()): SkillInfo[] {
  const skillsDir = getSkillsDir(projectDir);

  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: SkillInfo[] = [];

  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const name of dirs) {
      const skillPath = join(skillsDir, name);
      const skillMdPath = join(skillPath, 'SKILL.md');
      const referencesPath = join(skillPath, 'references');

      const hasSkillMd = existsSync(skillMdPath);
      const hasReferences = existsSync(referencesPath) && statSync(referencesPath).isDirectory();

      let description: string | undefined;
      if (hasSkillMd) {
        try {
          const content = readFileSync(skillMdPath, 'utf-8');
          const frontmatter = parseFrontmatter(content);
          description = frontmatter?.description as string | undefined;
        } catch {
          // Ignore parse errors
        }
      }

      skills.push({
        name,
        path: skillPath,
        hasSkillMd,
        hasReferences,
        description
      });
    }
  } catch {
    // Return empty on error
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if an extension already exists
 */
export function extensionExists(name: string, projectDir: string = process.cwd()): boolean {
  const extPath = join(getExtensionsDir(projectDir), name);
  return existsSync(extPath);
}

/**
 * Generate gemini-extension.json content
 */
export function generateExtensionJson(frontmatter: SkillFrontmatter, hasReferences: boolean): GeminiExtension {
  const contextFileName: string[] = ['SKILL.md'];
  if (hasReferences) {
    contextFileName.push('references/*.md');
  }

  return {
    name: frontmatter.name || '',
    version: '1.0.0',
    description: (frontmatter.description as string) || '',
    license: 'MIT',
    contextFileName
  };
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(src: string, dest: string, created: string[]): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    created.push(dest);
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, created);
    } else {
      copyFileSync(srcPath, destPath);
      created.push(destPath);
    }
  }
}

/**
 * Convert a single skill to extension
 */
export function convertSkill(
  skillName: string,
  options: ConvertOptions = {},
  projectDir: string = process.cwd()
): ConversionResult {
  const result: ConversionResult = {
    skill: skillName,
    success: false,
    created: [],
    skipped: [],
    errors: []
  };

  const skillsDir = getSkillsDir(projectDir);
  const extensionsDir = getExtensionsDir(projectDir);
  const skillPath = join(skillsDir, skillName);
  const extPath = join(extensionsDir, skillName);

  // Check if skill exists
  if (!existsSync(skillPath)) {
    result.errors.push(`Skill not found: ${skillName}`);
    return result;
  }

  // Check if SKILL.md exists
  const skillMdPath = join(skillPath, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    result.errors.push(`SKILL.md not found in ${skillName}`);
    return result;
  }

  // Check if extension already exists
  if (extensionExists(skillName, projectDir) && !options.force) {
    result.skipped.push(`Extension already exists: ${skillName} (use --force to overwrite)`);
    return result;
  }

  // Parse frontmatter
  let frontmatter: SkillFrontmatter | null = null;
  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    frontmatter = parseFrontmatter(content);
  } catch (e) {
    result.errors.push(`Failed to read SKILL.md: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  if (!frontmatter || !frontmatter.name) {
    // Try to use directory name if no frontmatter
    frontmatter = {
      name: skillName,
      description: ''
    };
  }

  // Check for references
  const referencesPath = join(skillPath, 'references');
  const hasReferences = existsSync(referencesPath) && statSync(referencesPath).isDirectory();

  // Generate extension JSON
  const extensionJson = generateExtensionJson(frontmatter, hasReferences);

  if (options.dryRun) {
    result.created.push(`[DRY RUN] Would create: ${extPath}`);
    result.created.push(`[DRY RUN] Would create: ${join(extPath, 'gemini-extension.json')}`);
    result.created.push(`[DRY RUN] Would copy: SKILL.md`);
    if (hasReferences) {
      result.created.push(`[DRY RUN] Would copy: references/`);
    }
    result.success = true;
    return result;
  }

  try {
    // Create extension directory
    if (!existsSync(extPath)) {
      mkdirSync(extPath, { recursive: true });
      result.created.push(extPath);
    }

    // Write gemini-extension.json
    const jsonPath = join(extPath, 'gemini-extension.json');
    writeFileSync(jsonPath, JSON.stringify(extensionJson, null, 2) + '\n');
    result.created.push(jsonPath);

    // Copy SKILL.md
    const destSkillMd = join(extPath, 'SKILL.md');
    copyFileSync(skillMdPath, destSkillMd);
    result.created.push(destSkillMd);

    // Copy references if exists
    if (hasReferences) {
      const destReferences = join(extPath, 'references');
      copyDirRecursive(referencesPath, destReferences, result.created);
    }

    // Copy any other files (assets, scripts, etc.)
    const entries = readdirSync(skillPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'SKILL.md' || entry.name === 'references') continue;

      const srcPath = join(skillPath, entry.name);
      const destPath = join(extPath, entry.name);

      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath, result.created);
      } else {
        copyFileSync(srcPath, destPath);
        result.created.push(destPath);
      }
    }

    result.success = true;
  } catch (e) {
    result.errors.push(`Failed to convert: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/**
 * Convert all skills to extensions
 */
export function convertAllSkills(
  options: ConvertOptions = {},
  projectDir: string = process.cwd()
): ConversionResult[] {
  const skills = listSkills(projectDir);
  const results: ConversionResult[] = [];

  for (const skill of skills) {
    const result = convertSkill(skill.name, options, projectDir);
    results.push(result);
  }

  return results;
}

/**
 * Get conversion summary
 */
export function getConversionSummary(results: ConversionResult[]): {
  total: number;
  success: number;
  skipped: number;
  failed: number;
} {
  return {
    total: results.length,
    success: results.filter(r => r.success && r.errors.length === 0 && r.skipped.length === 0).length,
    skipped: results.filter(r => r.skipped.length > 0).length,
    failed: results.filter(r => r.errors.length > 0).length
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get Claude agents directory path
 */
export function getClaudeAgentsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, CLAUDE_AGENTS_DIR);
}

/**
 * Get Gemini agents directory path
 */
export function getGeminiAgentsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, GEMINI_AGENTS_DIR);
}

/**
 * Parse agent frontmatter
 */
export function parseAgentFrontmatter(content: string): AgentFrontmatter | null {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;

  return {
    name: frontmatter.name || '',
    description: (frontmatter.description as string) || '',
    model: frontmatter.model as string | undefined,
    skills: frontmatter.skills as string | undefined
  };
}

/**
 * List all available Claude agents
 */
export function listAgents(projectDir: string = process.cwd()): AgentInfo[] {
  const agentsDir = getClaudeAgentsDir(projectDir);

  if (!existsSync(agentsDir)) {
    return [];
  }

  const agents: AgentInfo[] = [];

  try {
    const files = readdirSync(agentsDir, { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.md'))
      .map(f => f.name);

    for (const file of files) {
      const filePath = join(agentsDir, file);
      const name = file.replace(/\.md$/, '');

      let description: string | undefined;
      let model: string | undefined;
      let skills: string | undefined;

      try {
        const content = readFileSync(filePath, 'utf-8');
        const frontmatter = parseAgentFrontmatter(content);
        if (frontmatter) {
          description = frontmatter.description;
          model = frontmatter.model;
          skills = frontmatter.skills;
        }
      } catch {
        // Ignore parse errors
      }

      agents.push({
        name,
        path: filePath,
        description,
        model,
        skills
      });
    }
  } catch {
    // Return empty on error
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if an agent already exists in Gemini
 */
export function geminiAgentExists(name: string, projectDir: string = process.cwd()): boolean {
  const agentPath = join(getGeminiAgentsDir(projectDir), `${name}.md`);
  return existsSync(agentPath);
}

/**
 * Map Claude model to Gemini model
 */
export function mapModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return MODEL_MAPPING[model] || model;
}

/**
 * Update frontmatter in markdown content
 */
function updateFrontmatter(content: string, updates: Record<string, string | undefined>): string {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!match) return content;

  const [fullMatch, startDelim, frontmatterContent, endDelim] = match;
  const lines = frontmatterContent.split(/\r?\n/);
  const newLines: string[] = [];
  const processedKeys = new Set<string>();

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      newLines.push(line);
      continue;
    }

    const key = line.slice(0, colonIndex).trim();

    if (key in updates) {
      processedKeys.add(key);
      if (updates[key] !== undefined) {
        newLines.push(`${key}: ${updates[key]}`);
      }
      // If undefined, skip the line (remove the field)
    } else {
      newLines.push(line);
    }
  }

  // Add any new keys that weren't in the original
  for (const [key, value] of Object.entries(updates)) {
    if (!processedKeys.has(key) && value !== undefined) {
      newLines.push(`${key}: ${value}`);
    }
  }

  const newFrontmatter = startDelim + newLines.join('\n') + endDelim;
  return content.replace(fullMatch, newFrontmatter);
}

/**
 * Convert a single agent from Claude to Gemini
 */
export function convertAgent(
  agentName: string,
  options: ConvertOptions = {},
  projectDir: string = process.cwd()
): ConversionResult {
  const result: ConversionResult = {
    skill: agentName, // Reusing skill field for agent name
    success: false,
    created: [],
    skipped: [],
    errors: []
  };

  const claudeAgentsDir = getClaudeAgentsDir(projectDir);
  const geminiAgentsDir = getGeminiAgentsDir(projectDir);
  const srcPath = join(claudeAgentsDir, `${agentName}.md`);
  const destPath = join(geminiAgentsDir, `${agentName}.md`);

  // Check if source agent exists
  if (!existsSync(srcPath)) {
    result.errors.push(`Agent not found: ${agentName}`);
    return result;
  }

  // Check if destination already exists
  if (geminiAgentExists(agentName, projectDir) && !options.force) {
    result.skipped.push(`Agent already exists in .gemini/agents: ${agentName} (use --force to overwrite)`);
    return result;
  }

  // Read source content
  let content: string;
  try {
    content = readFileSync(srcPath, 'utf-8');
  } catch (e) {
    result.errors.push(`Failed to read agent file: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  // Parse frontmatter to get model
  const frontmatter = parseAgentFrontmatter(content);
  const originalModel = frontmatter?.model;
  const mappedModel = mapModel(originalModel);

  // Update model if mapping exists and is different
  let finalContent = content;
  if (originalModel && mappedModel && originalModel !== mappedModel) {
    finalContent = updateFrontmatter(content, { model: mappedModel });
  }

  if (options.dryRun) {
    result.created.push(`[DRY RUN] Would create: ${destPath}`);
    if (originalModel && mappedModel && originalModel !== mappedModel) {
      result.created.push(`[DRY RUN] Would map model: ${originalModel} -> ${mappedModel}`);
    }
    result.success = true;
    return result;
  }

  try {
    // Ensure destination directory exists
    if (!existsSync(geminiAgentsDir)) {
      mkdirSync(geminiAgentsDir, { recursive: true });
    }

    // Write converted agent
    writeFileSync(destPath, finalContent);
    result.created.push(destPath);

    if (originalModel && mappedModel && originalModel !== mappedModel) {
      result.created.push(`Model mapped: ${originalModel} -> ${mappedModel}`);
    }

    result.success = true;
  } catch (e) {
    result.errors.push(`Failed to convert: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/**
 * Convert all agents from Claude to Gemini
 */
export function convertAllAgents(
  options: ConvertOptions = {},
  projectDir: string = process.cwd()
): ConversionResult[] {
  const agents = listAgents(projectDir);
  const results: ConversionResult[] = [];

  for (const agent of agents) {
    const result = convertAgent(agent.name, options, projectDir);
    results.push(result);
  }

  return results;
}
