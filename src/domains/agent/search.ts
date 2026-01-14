/**
 * Agent-Skill Composer Search - BM25 search engine for Agent+Skills combinations
 * Ported from Python core.py with same logic
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { SearchResult, Intent, Domain, Complexity, SkillInfo } from './types.js';
import { getExtensionsDir } from '../../utils/paths.js';

// ============ CONFIGURATION ============
const DATA_DIR = '.gemini/extensions/spawn-agent/data';
const MAX_RESULTS = 3;

// CSV Configuration for different search modes
const CSV_CONFIG = {
  combination: {
    file: 'combinations.csv',
    searchCols: ['keywords', 'description', 'use_when', 'agent', 'skills', 'intent', 'domain'],
    outputCols: ['id', 'agent', 'skills', 'intent', 'domain', 'complexity', 'description', 'use_when']
  },
  intent: {
    file: 'intents.csv',
    searchCols: ['primary_keywords', 'expanded_keywords', 'question_patterns'],
    outputCols: ['intent', 'agent', 'primary_keywords', 'expanded_keywords', 'action_verbs']
  },
  domain: {
    file: 'domains.csv',
    searchCols: ['keywords', 'frameworks', 'file_patterns', 'technical_terms'],
    outputCols: ['domain', 'base_skills', 'enhanced_skills', 'keywords', 'frameworks']
  },
  synonym: {
    file: 'synonyms.csv',
    searchCols: ['word', 'synonyms'],
    outputCols: ['word', 'synonyms', 'category']
  }
};

// Complexity keywords for skill count determination
const COMPLEXITY_KEYWORDS: Record<Complexity, string[]> = {
  simple: ['quick', 'simple', 'basic', 'small', 'minor', 'trivial', 'easy', 'straightforward'],
  standard: [],
  full: ['comprehensive', 'full', 'complete', 'entire', 'thorough', 'detailed'],
  complex: ['deep', 'extensive', 'advanced', 'complex', 'sophisticated', 'enterprise', 'production']
};

// Max skills per complexity level
const COMPLEXITY_MAX_SKILLS: Record<Complexity, number> = {
  simple: 1,
  standard: 2,
  full: 3,
  complex: 5
};

// Intent to agent mapping
const INTENT_AGENT_MAP: Record<Intent, string> = {
  research: 'researcher',
  plan: 'planner',
  execute: 'code-executor',
  debug: 'debugger',
  review: 'code-reviewer',
  test: 'tester',
  design: 'ui-ux-designer',
  docs: 'docs-manager',
  git: 'git-manager',
  manage: 'project-manager'
};

// Domain to skill mapping (fallback)
const DOMAIN_SKILL_MAP: Record<string, string[]> = {
  frontend: ['frontend-design'],
  backend: ['backend-development'],
  auth: ['better-auth', 'backend-development'],
  payment: ['payment-integration'],
  database: ['databases'],
  mobile: ['mobile-development'],
  fullstack: ['web-frameworks', 'backend-development'],
  ecommerce: ['shopify'],
  media: ['ai-multimodal'],
  ai: ['ai-multimodal'],
  quality: ['code-review'],
  codebase: ['repomix'],
  general: ['research']
};

// ============ BM25 IMPLEMENTATION ============
class BM25 {
  private k1: number;
  private b: number;
  private corpus: string[][] = [];
  private docLengths: number[] = [];
  private avgdl: number = 0;
  private idf: Map<string, number> = new Map();
  private docFreqs: Map<string, number> = new Map();
  private N: number = 0;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  tokenize(text: string): string[] {
    const cleaned = String(text).toLowerCase().replace(/[^\w\s]/g, ' ');
    return cleaned.split(/\s+/).filter(w => w.length > 1);
  }

  fit(documents: string[]): void {
    this.corpus = documents.map(doc => this.tokenize(doc));
    this.N = this.corpus.length;
    if (this.N === 0) return;

    this.docLengths = this.corpus.map(doc => doc.length);
    this.avgdl = this.docLengths.reduce((a, b) => a + b, 0) / this.N;

    for (const doc of this.corpus) {
      const seen = new Set<string>();
      for (const word of doc) {
        if (!seen.has(word)) {
          this.docFreqs.set(word, (this.docFreqs.get(word) || 0) + 1);
          seen.add(word);
        }
      }
    }

    for (const [word, freq] of this.docFreqs.entries()) {
      this.idf.set(word, Math.log((this.N - freq + 0.5) / (freq + 0.5) + 1));
    }
  }

  score(query: string): Array<[number, number]> {
    const queryTokens = this.tokenize(query);
    const scores: Array<[number, number]> = [];

    for (let idx = 0; idx < this.corpus.length; idx++) {
      const doc = this.corpus[idx];
      let score = 0;
      const docLen = this.docLengths[idx];
      const termFreqs = new Map<string, number>();

      for (const word of doc) {
        termFreqs.set(word, (termFreqs.get(word) || 0) + 1);
      }

      for (const token of queryTokens) {
        const idfVal = this.idf.get(token);
        if (idfVal !== undefined) {
          const tf = termFreqs.get(token) || 0;
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * docLen / this.avgdl);
          score += idfVal * numerator / denominator;
        }
      }

      scores.push([idx, score]);
    }

    return scores.sort((a, b) => b[1] - a[1]);
  }
}

// ============ CSV UTILITIES ============
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function loadCSV(filepath: string): Record<string, string>[] {
  if (!existsSync(filepath)) return [];

  const content = readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() || '';
    });
    rows.push(row);
  }

  return rows;
}

function searchCSV(
  filepath: string,
  searchCols: string[],
  outputCols: string[],
  query: string,
  maxResults: number
): Array<Record<string, any>> {
  if (!existsSync(filepath)) return [];

  const data = loadCSV(filepath);
  const documents = data.map(row =>
    searchCols.map(col => String(row[col] || '')).join(' ')
  );

  const bm25 = new BM25();
  bm25.fit(documents);
  const ranked = bm25.score(query);

  const results: Array<Record<string, any>> = [];
  for (const [idx, score] of ranked.slice(0, maxResults)) {
    if (score > 0) {
      const row = data[idx];
      const result: Record<string, any> = {};
      for (const col of outputCols) {
        if (col in row) result[col] = row[col];
      }
      result._score = Math.round(score * 10000) / 10000;
      results.push(result);
    }
  }

  return results;
}

// ============ SYNONYM EXPANSION ============
function loadSynonyms(): Map<string, string[]> {
  const filepath = join(DATA_DIR, 'synonyms.csv');
  if (!existsSync(filepath)) return new Map();

  const data = loadCSV(filepath);
  const synonyms = new Map<string, string[]>();

  for (const row of data) {
    const word = (row.word || '').toLowerCase().trim();
    const syns = (row.synonyms || '').toLowerCase().trim();
    if (word && syns) {
      synonyms.set(word, syns.split(',').map(s => s.trim()));
    }
  }

  return synonyms;
}

function expandQuery(query: string, synonyms?: Map<string, string[]>): string {
  if (!synonyms) synonyms = loadSynonyms();

  const words = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/);
  const expanded = new Set(words);

  for (const word of words) {
    const syns = synonyms.get(word);
    if (syns) {
      syns.forEach(s => expanded.add(s));
    }
  }

  return Array.from(expanded).join(' ');
}

// ============ DETECTION FUNCTIONS ============
export function detectComplexity(query: string): Complexity {
  const queryLower = query.toLowerCase();

  for (const [level, keywords] of Object.entries(COMPLEXITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (queryLower.includes(kw)) {
        return level as Complexity;
      }
    }
  }

  return 'standard';
}

export function detectIntent(query: string): Intent {
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);
  const firstWord = words[0] || '';

  // High-priority phrase patterns
  const highPriorityPatterns: Array<[RegExp | string, Intent]> = [
    [/system architecture/, 'plan'],
    [/design.*architecture/, 'plan'],
    [/architect.*system/, 'plan'],
    [/create.*roadmap/, 'plan'],
    [/build.*roadmap/, 'plan'],
    [/create.*strategy/, 'plan'],
    [/stunning/, 'design'],
    [/gorgeous/, 'design'],
    [/beautiful.*ui/, 'design'],
    [/beautiful.*component/, 'design'],
    [/beautiful.*page/, 'design'],
    [/write.*documentation/, 'docs'],
    [/write.*docs/, 'docs'],
    [/create.*documentation/, 'docs'],
    [/research.*codebase/, 'research'],
    [/deep research/, 'research'],
  ];

  for (const [pattern, intent] of highPriorityPatterns) {
    if (typeof pattern === 'string' ? queryLower.includes(pattern) : pattern.test(queryLower)) {
      return intent;
    }
  }

  // Primary action verbs - first word priority
  const primaryActionVerbs: Record<string, Intent> = {
    implement: 'execute', build: 'execute', create: 'execute', add: 'execute',
    make: 'execute', code: 'execute', develop: 'execute', write: 'execute',
    setup: 'execute', configure: 'execute',
    test: 'test', verify: 'test', validate: 'test',
    debug: 'debug', fix: 'debug', troubleshoot: 'debug',
    review: 'review', audit: 'review',
    document: 'docs',
    plan: 'plan',
    design: 'design',
    research: 'research', analyze: 'research', investigate: 'research',
  };

  if (firstWord in primaryActionVerbs) {
    return primaryActionVerbs[firstWord];
  }

  // Priority phrases
  const priorityPhrases: Array<[string, Intent]> = [
    ['best practices', 'research'], ['how does', 'research'], ['how do', 'research'],
    ['what is', 'research'], ['why is', 'research'], ['compare', 'research'],
    ['investigate', 'research'], ['research', 'research'], ['understand', 'research'],
    ['system architecture', 'plan'], ['implementation plan', 'plan'], ['roadmap', 'plan'],
    ['strategy for', 'plan'], ['blueprint', 'plan'],
    ['fix the', 'debug'], ['debug the', 'debug'], ['not working', 'debug'],
    ['is broken', 'debug'], ['error in', 'debug'], ['fix bug', 'debug'],
    ['test the', 'test'], ['run tests', 'test'], ['verify the', 'test'],
    ['review the', 'review'], ['audit the', 'review'], ['check code', 'review'],
    ['document the', 'docs'], ['write docs', 'docs'], ['api documentation', 'docs'],
  ];

  for (const [phrase, intent] of priorityPhrases) {
    if (queryLower.includes(phrase)) {
      return intent;
    }
  }

  // Intent detection keywords (fallback scoring)
  const intentKeywords: Record<Intent, string[]> = {
    debug: ['fix', 'debug', 'troubleshoot', 'error', 'issue', 'bug', 'broken', 'failing', 'crash'],
    review: ['review', 'audit', 'assess', 'check code', 'pr review', 'security audit'],
    test: ['test', 'verify', 'validate', 'qa', 'coverage', 'unit test', 'e2e test'],
    design: ['beautiful', 'stunning', 'gorgeous', 'ui design', 'ux design', 'mockup', 'layout'],
    docs: ['document', 'documentation', 'readme', 'api docs', 'technical writing'],
    git: ['commit', 'push', 'pull', 'merge', 'branch', 'git', 'stage'],
    manage: ['status', 'progress', 'track', 'milestone', 'sprint'],
    plan: ['plan', 'architect', 'roadmap', 'strategy', 'architecture design'],
    execute: ['implement', 'build', 'create', 'add', 'make', 'code', 'develop'],
    research: ['research', 'investigate', 'explore', 'study', 'analyze', 'examine', 'learn']
  };

  const scores: Partial<Record<Intent, number>> = {};
  for (const [intent, keywords] of Object.entries(intentKeywords)) {
    const score = keywords.filter(kw => queryLower.includes(kw)).length;
    if (score > 0) scores[intent as Intent] = score;
  }

  if (Object.keys(scores).length > 0) {
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as Intent;
  }

  return 'execute';
}

export function detectDomain(query: string): Domain {
  const queryLower = query.toLowerCase();

  // Priority domain phrases
  const domainPhrases: Array<[string, Domain]> = [
    ['flutter', 'mobile'], ['react native', 'mobile'], ['swift', 'mobile'],
    ['kotlin', 'mobile'], ['ios app', 'mobile'], ['android app', 'mobile'],
    ['next.js', 'fullstack'], ['nextjs', 'fullstack'], ['nuxt', 'fullstack'],
    ['sveltekit', 'fullstack'], ['remix', 'fullstack'], ['server component', 'fullstack'],
    ['openai', 'ai'], ['anthropic', 'ai'], ['claude', 'ai'], ['langchain', 'ai'],
    ['llm', 'ai'], ['chatbot', 'ai'], ['rag', 'ai'], ['embedding', 'ai'], ['gpt', 'ai'],
    ['angular', 'frontend'], ['react', 'frontend'], ['vue', 'frontend'],
    ['svelte', 'frontend'], ['tailwind', 'frontend'],
    ['nestjs', 'backend'], ['express', 'backend'], ['fastify', 'backend'],
    ['hono', 'backend'], ['fastapi', 'backend'], ['websocket', 'backend'],
    ['shopify', 'ecommerce'], ['product catalog', 'ecommerce'], ['checkout flow', 'ecommerce'],
    ['stripe', 'payment'], ['paypal', 'payment'], ['subscription', 'payment'], ['billing', 'payment'],
    ['oauth', 'auth'], ['authentication', 'auth'], ['login', 'auth'], ['signup', 'auth'],
    ['prisma', 'database'], ['drizzle', 'database'], ['postgresql', 'database'],
    ['mongodb', 'database'], ['mysql', 'database'],
    ['pdf', 'media'], ['image', 'media'], ['video', 'media'], ['audio', 'media'],
    ['codebase', 'codebase'], ['repository', 'codebase'],
  ];

  for (const [phrase, domain] of domainPhrases) {
    if (queryLower.includes(phrase)) {
      return domain;
    }
  }

  // Domain detection keywords (fallback scoring)
  const domainKeywords: Record<Domain, string[]> = {
    auth: ['login', 'signup', 'authentication', 'oauth', 'jwt', 'session', 'password', '2fa'],
    payment: ['payment', 'checkout', 'billing', 'stripe', 'subscription', 'invoice', 'cart'],
    database: ['database', 'sql', 'query', 'migration', 'schema', 'prisma', 'postgresql'],
    frontend: ['ui', 'component', 'react', 'vue', 'css', 'tailwind', 'button', 'form', 'modal'],
    backend: ['api', 'endpoint', 'server', 'service', 'route', 'rest', 'graphql', 'middleware'],
    mobile: ['mobile', 'ios', 'android', 'react native', 'flutter', 'app', 'native'],
    fullstack: ['fullstack', 'nextjs', 'next.js', 'nuxt', 'sveltekit', 'app router'],
    ecommerce: ['ecommerce', 'shopify', 'store', 'product', 'cart', 'checkout', 'order'],
    media: ['image', 'video', 'audio', 'media', 'upload', 'file', 'ocr'],
    ai: ['ai', 'llm', 'gpt', 'claude', 'machine learning', 'embedding', 'vector', 'openai'],
    quality: ['code review', 'lint', 'test', 'coverage', 'quality', 'refactor'],
    codebase: ['codebase', 'repository', 'repo', 'project structure'],
    general: []
  };

  const scores: Partial<Record<Domain, number>> = {};
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    const score = keywords.filter(kw => queryLower.includes(kw)).length;
    if (score > 0) scores[domain as Domain] = score;
  }

  if (Object.keys(scores).length > 0) {
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as Domain;
  }

  return 'general';
}

// ============ MAIN SEARCH FUNCTIONS ============
export function searchCombinations(
  query: string,
  maxResults = MAX_RESULTS,
  expand = true
): {
  query: string;
  expandedQuery?: string;
  detectedIntent: Intent;
  detectedDomain: Domain;
  detectedComplexity: Complexity;
  count: number;
  results: Array<Record<string, any>>;
} {
  const config = CSV_CONFIG.combination;
  const filepath = join(DATA_DIR, config.file);

  let searchQuery = query;
  if (expand) {
    const synonyms = loadSynonyms();
    searchQuery = expandQuery(query, synonyms);
  }

  const results = searchCSV(filepath, config.searchCols, config.outputCols, searchQuery, maxResults);

  return {
    query,
    expandedQuery: expand ? searchQuery : undefined,
    detectedIntent: detectIntent(query),
    detectedDomain: detectDomain(query),
    detectedComplexity: detectComplexity(query),
    count: results.length,
    results
  };
}

export function searchCombinationsFiltered(
  query: string,
  intentFilter?: Intent,
  domainFilter?: Domain,
  maxResults = MAX_RESULTS,
  expand = true
): { results: Array<Record<string, any>>; count: number } {
  const config = CSV_CONFIG.combination;
  const filepath = join(DATA_DIR, config.file);

  if (!existsSync(filepath)) {
    return { results: [], count: 0 };
  }

  let data = loadCSV(filepath);

  // Apply filters
  if (intentFilter) {
    data = data.filter(row => (row.intent || '').toLowerCase() === intentFilter.toLowerCase());
  }
  if (domainFilter) {
    data = data.filter(row => (row.domain || '').toLowerCase() === domainFilter.toLowerCase());
  }

  if (data.length === 0) {
    return { results: [], count: 0 };
  }

  let searchQuery = query;
  if (expand) {
    const synonyms = loadSynonyms();
    searchQuery = expandQuery(query, synonyms);
  }

  const documents = data.map(row =>
    config.searchCols.map(col => String(row[col] || '')).join(' ')
  );

  const bm25 = new BM25();
  bm25.fit(documents);
  const ranked = bm25.score(searchQuery);

  const results: Array<Record<string, any>> = [];
  for (const [idx, score] of ranked.slice(0, maxResults)) {
    if (score > 0) {
      const row = data[idx];
      const result: Record<string, any> = {};
      for (const col of config.outputCols) {
        if (col in row) result[col] = row[col];
      }
      result._score = Math.round(score * 10000) / 10000;
      results.push(result);
    }
  }

  return { results, count: results.length };
}

export function getBestCombination(query: string): SearchResult {
  const detectedIntent = detectIntent(query);
  const detectedDomain = detectDomain(query);
  const detectedComplexity = detectComplexity(query);

  // Priority intents - try intent-filtered search first
  const priorityIntents: Intent[] = ['debug', 'review', 'test', 'design', 'docs', 'research', 'plan'];

  if (priorityIntents.includes(detectedIntent)) {
    const filtered = searchCombinationsFiltered(query, detectedIntent, undefined, 1, true);

    if (filtered.results.length > 0) {
      const best = filtered.results[0];
      const skillsStr = best.skills || '';
      const skillsList = skillsStr.split('|').map((s: string) => s.trim()).filter(Boolean);

      return {
        agent: INTENT_AGENT_MAP[detectedIntent] || best.agent || 'code-executor',
        skills: skillsList,
        intent: detectedIntent,
        domain: best.domain || detectedDomain,
        complexity: best.complexity || detectedComplexity,
        score: best._score || 0,
        fallback: false,
        description: best.description || '',
        useWhen: best.use_when || ''
      };
    }
  }

  // For execute intent with specific domain, try domain-filtered search
  const priorityDomains: Domain[] = ['mobile', 'ai', 'payment', 'ecommerce', 'media', 'auth', 'database', 'fullstack'];
  if (detectedIntent === 'execute' && priorityDomains.includes(detectedDomain)) {
    const filtered = searchCombinationsFiltered(query, 'execute', detectedDomain, 1, true);

    if (filtered.results.length > 0) {
      const best = filtered.results[0];
      const skillsStr = best.skills || '';
      const skillsList = skillsStr.split('|').map((s: string) => s.trim()).filter(Boolean);

      return {
        agent: 'code-executor',
        skills: skillsList,
        intent: detectedIntent,
        domain: detectedDomain,
        complexity: best.complexity || detectedComplexity,
        score: best._score || 0,
        fallback: false,
        description: best.description || '',
        useWhen: best.use_when || ''
      };
    }
  }

  // Default: search all combinations
  const result = searchCombinations(query, 1, true);

  if (result.count === 0) {
    // Fallback: use detected intent/domain to construct a basic combination
    const agent = INTENT_AGENT_MAP[detectedIntent] || 'code-executor';
    const skills = DOMAIN_SKILL_MAP[detectedDomain] || ['research'];

    return {
      agent,
      skills,
      intent: detectedIntent,
      domain: detectedDomain,
      complexity: detectedComplexity,
      score: 0,
      fallback: true,
      description: `Fallback combination based on detected intent (${detectedIntent}) and domain (${detectedDomain})`
    };
  }

  const best = result.results[0];
  const skillsStr = best.skills || '';
  const skillsList = skillsStr.split('|').map((s: string) => s.trim()).filter(Boolean);

  return {
    agent: best.agent || 'code-executor',
    skills: skillsList,
    intent: best.intent || detectedIntent,
    domain: best.domain || detectedDomain,
    complexity: best.complexity || detectedComplexity,
    score: best._score || 0,
    fallback: false,
    description: best.description || '',
    useWhen: best.use_when || ''
  };
}

/**
 * Main search function - returns multiple results
 */
export function searchAgentSkillCombination(task: string, options?: {
  top?: number;
  forceIntent?: Intent;
  forceDomain?: Domain;
  maxSkills?: number;
}): SearchResult[] {
  const { top = 5, forceIntent, forceDomain, maxSkills } = options || {};

  // If forcing intent or domain, use filtered search
  if (forceIntent || forceDomain) {
    const filtered = searchCombinationsFiltered(task, forceIntent, forceDomain, top, true);

    return filtered.results.map(r => {
      const skillsStr = r.skills || '';
      let skillsList = skillsStr.split('|').map((s: string) => s.trim()).filter(Boolean);

      if (maxSkills) {
        skillsList = skillsList.slice(0, maxSkills);
      }

      return {
        agent: forceIntent ? INTENT_AGENT_MAP[forceIntent] : r.agent || 'code-executor',
        skills: skillsList,
        intent: r.intent || forceIntent || detectIntent(task),
        domain: r.domain || forceDomain || detectDomain(task),
        complexity: r.complexity || detectComplexity(task),
        score: r._score || 0,
        fallback: false,
        description: r.description || '',
        useWhen: r.use_when || ''
      };
    });
  }

  // Standard search
  const result = searchCombinations(task, top, true);

  if (result.count === 0) {
    // Return fallback
    const best = getBestCombination(task);
    return [best];
  }

  return result.results.map(r => {
    const skillsStr = r.skills || '';
    let skillsList = skillsStr.split('|').map((s: string) => s.trim()).filter(Boolean);

    if (maxSkills) {
      skillsList = skillsList.slice(0, maxSkills);
    }

    return {
      agent: r.agent || 'code-executor',
      skills: skillsList,
      intent: r.intent || result.detectedIntent,
      domain: r.domain || result.detectedDomain,
      complexity: r.complexity || result.detectedComplexity,
      score: r._score || 0,
      fallback: false,
      description: r.description || '',
      useWhen: r.use_when || ''
    };
  });
}

// ============ SKILL UTILITIES (backward compatibility) ============
/**
 * List all available skills from extensions
 */
export function listAllSkills(projectDir?: string): SkillInfo[] {
  const extensionsDir = getExtensionsDir(projectDir);
  const skills: SkillInfo[] = [];

  if (!existsSync(extensionsDir)) {
    return skills;
  }

  const extensions = readdirSync(extensionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const ext of extensions) {
    const skillPath = join(extensionsDir, ext, 'SKILL.md');
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, 'utf-8');
      skills.push({
        name: ext,
        path: skillPath,
        content,
      });
    }
  }

  return skills;
}

/**
 * Load skill content by name
 */
export function loadSkillContent(skillName: string, projectDir?: string): string | null {
  const extensionsDir = getExtensionsDir(projectDir);
  const skillPath = join(extensionsDir, skillName, 'SKILL.md');

  if (!existsSync(skillPath)) {
    return null;
  }

  return readFileSync(skillPath, 'utf-8');
}

// Re-export for backward compatibility
export { loadSynonyms, expandQuery, INTENT_AGENT_MAP, DOMAIN_SKILL_MAP, COMPLEXITY_MAX_SKILLS };
