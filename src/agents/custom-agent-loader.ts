/**
 * Custom Agent Loader - Auto-discovers agent definitions from .md files
 *
 * Supports loading custom agent definitions from:
 * - .claude-flow/agents/
 * - .claude/agents/
 *
 * Agent files use YAML frontmatter for configuration and markdown body as system prompt.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Custom agent definition structure
 * Supports both direct fields and metadata wrapper for backwards compatibility
 */
export interface CustomAgentDefinition {
  /** Unique agent name/identifier */
  name: string;
  /** Base agent type (coder, researcher, analyst, etc.) */
  type?: string;
  /** Display color (hex or named) */
  color?: string;
  /** Human-readable description */
  description: string;
  /** List of capabilities/skills */
  capabilities: string[];
  /** Task priority level */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Pre/post execution hooks */
  hooks?: {
    pre?: string;
    post?: string;
  };
  /** System prompt (markdown body content) */
  systemPrompt: string;
  /** Source file path */
  sourcePath: string;
  /** Category derived from directory structure */
  category?: string;
  /** Whether this is a custom agent (vs built-in) */
  isCustom: boolean;
}

/**
 * Validation result for an agent file
 */
export interface AgentValidationResult {
  valid: boolean;
  filePath: string;
  errors: string[];
  warnings: string[];
  agent?: CustomAgentDefinition;
}

/**
 * Statistics about loaded agents
 */
export interface AgentLoadStats {
  totalLoaded: number;
  customAgents: number;
  builtInAgents: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  errors: string[];
}

class CustomAgentLoader {
  private agentCache: Map<string, CustomAgentDefinition> = new Map();
  private lastLoadTime = 0;
  private cacheExpiry = 60000; // 1 minute cache
  private searchPaths: string[] = [];
  private loadErrors: string[] = [];

  constructor() {
    this.searchPaths = this.getSearchPaths();
  }

  /**
   * Get all directories to search for agent definitions
   */
  private getSearchPaths(): string[] {
    const paths: string[] = [];
    let currentDir = process.cwd();

    // Walk up from CWD to find .claude-flow/agents and .claude/agents
    while (currentDir !== '/' && currentDir !== dirname(currentDir)) {
      const claudeFlowAgentsPath = resolve(currentDir, '.claude-flow', 'agents');
      const claudeAgentsPath = resolve(currentDir, '.claude', 'agents');

      if (existsSync(claudeFlowAgentsPath)) {
        paths.push(claudeFlowAgentsPath);
      }
      if (existsSync(claudeAgentsPath)) {
        paths.push(claudeAgentsPath);
      }

      // If we found at least one, stop walking up
      if (paths.length > 0) {
        break;
      }

      currentDir = dirname(currentDir);
    }

    // Fallback to relative paths from CWD if nothing found
    if (paths.length === 0) {
      const defaultClaudeFlowPath = resolve(process.cwd(), '.claude-flow', 'agents');
      const defaultClaudePath = resolve(process.cwd(), '.claude', 'agents');

      if (existsSync(defaultClaudeFlowPath)) {
        paths.push(defaultClaudeFlowPath);
      }
      if (existsSync(defaultClaudePath)) {
        paths.push(defaultClaudePath);
      }
    }

    return paths;
  }

  /**
   * Recursively find all .md files in a directory
   */
  private findMarkdownFiles(dir: string): string[] {
    const files: string[] = [];

    if (!existsSync(dir)) {
      return files;
    }

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        files.push(...this.findMarkdownFiles(fullPath));
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        // Skip README and other documentation files
        const lowerName = entry.name.toLowerCase();
        if (lowerName !== 'readme.md' && !lowerName.includes('migration')) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Parse YAML frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { frontmatter: Record<string, any> | null; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    if (!match) {
      return { frontmatter: null, body: content };
    }

    try {
      const yamlContent = match[1];
      const markdownBody = match[2];
      const frontmatter = parseYaml(yamlContent);
      return { frontmatter, body: markdownBody.trim() };
    } catch (error) {
      return { frontmatter: null, body: content };
    }
  }

  /**
   * Extract category from file path
   */
  private extractCategory(filePath: string, baseDir: string): string {
    const relativePath = filePath.replace(baseDir, '').replace(/^[\/\\]/, '');
    const parts = relativePath.split(/[\/\\]/);

    // If file is in a subdirectory, use first directory as category
    if (parts.length > 1) {
      return parts[0];
    }

    return 'custom';
  }

  /**
   * Parse a single agent file into a CustomAgentDefinition
   */
  private parseAgentFile(filePath: string, baseDir: string): CustomAgentDefinition | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = this.parseFrontmatter(content);

      if (!frontmatter) {
        this.loadErrors.push(`No frontmatter found in ${filePath}`);
        return null;
      }

      // Support both direct description and metadata.description
      const description = frontmatter.description ||
                         frontmatter.metadata?.description ||
                         `Agent defined in ${basename(filePath)}`;

      // Support both direct capabilities and metadata.capabilities
      const capabilities = frontmatter.capabilities ||
                          frontmatter.metadata?.capabilities ||
                          [];

      // Agent name: prefer explicit name, fallback to filename
      const name = frontmatter.name ||
                  basename(filePath, '.md').toLowerCase().replace(/\s+/g, '-');

      if (!name) {
        this.loadErrors.push(`Missing name field in ${filePath}`);
        return null;
      }

      // Determine if this is a custom agent (from .claude-flow/agents/)
      const isCustom = baseDir.includes('.claude-flow');

      return {
        name,
        type: frontmatter.type,
        color: frontmatter.color,
        description,
        capabilities: Array.isArray(capabilities) ? capabilities : [capabilities],
        priority: frontmatter.priority || 'medium',
        hooks: frontmatter.hooks,
        systemPrompt: body,
        sourcePath: filePath,
        category: this.extractCategory(filePath, baseDir),
        isCustom,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.loadErrors.push(`Error parsing ${filePath}: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Load all agent definitions from configured search paths
   * Custom agents (.claude-flow/agents/) take precedence over built-in (.claude/agents/)
   */
  private async loadAgents(): Promise<void> {
    this.agentCache.clear();
    this.loadErrors = [];
    this.searchPaths = this.getSearchPaths();

    // Process in reverse order so .claude-flow agents override .claude agents
    // (since .claude-flow/agents is typically listed first)
    const processedPaths = [...this.searchPaths].reverse();

    for (const searchPath of processedPaths) {
      const files = this.findMarkdownFiles(searchPath);

      for (const filePath of files) {
        const agent = this.parseAgentFile(filePath, searchPath);
        if (agent) {
          // Custom agents (.claude-flow) override built-in (.claude)
          const existing = this.agentCache.get(agent.name);
          if (!existing || agent.isCustom) {
            this.agentCache.set(agent.name, agent);
          }
        }
      }
    }

    this.lastLoadTime = Date.now();
  }

  /**
   * Check if cache needs refresh
   */
  private needsRefresh(): boolean {
    return Date.now() - this.lastLoadTime > this.cacheExpiry;
  }

  /**
   * Ensure agents are loaded and cache is fresh
   */
  private async ensureLoaded(): Promise<void> {
    if (this.agentCache.size === 0 || this.needsRefresh()) {
      await this.loadAgents();
    }
  }

  /**
   * Get an agent definition by name
   */
  async getAgent(name: string): Promise<CustomAgentDefinition | null> {
    await this.ensureLoaded();
    return this.agentCache.get(name) || null;
  }

  /**
   * Get all loaded agent definitions
   */
  async getAllAgents(): Promise<CustomAgentDefinition[]> {
    await this.ensureLoaded();
    return Array.from(this.agentCache.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Get all available agent names
   */
  async getAvailableAgentNames(): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.agentCache.keys()).sort();
  }

  /**
   * Check if an agent exists by name
   */
  async hasAgent(name: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.agentCache.has(name);
  }

  /**
   * Get agents by category
   */
  async getAgentsByCategory(category: string): Promise<CustomAgentDefinition[]> {
    const agents = await this.getAllAgents();
    return agents.filter(agent => agent.category === category);
  }

  /**
   * Get agents by type
   */
  async getAgentsByType(type: string): Promise<CustomAgentDefinition[]> {
    const agents = await this.getAllAgents();
    return agents.filter(agent => agent.type === type);
  }

  /**
   * Get only custom agents (from .claude-flow/agents/)
   */
  async getCustomAgents(): Promise<CustomAgentDefinition[]> {
    const agents = await this.getAllAgents();
    return agents.filter(agent => agent.isCustom);
  }

  /**
   * Get only built-in agents (from .claude/agents/)
   */
  async getBuiltInAgents(): Promise<CustomAgentDefinition[]> {
    const agents = await this.getAllAgents();
    return agents.filter(agent => !agent.isCustom);
  }

  /**
   * Search agents by capabilities or description
   */
  async searchAgents(query: string): Promise<CustomAgentDefinition[]> {
    const agents = await this.getAllAgents();
    const lowerQuery = query.toLowerCase();

    return agents.filter(agent => {
      return (
        agent.name.toLowerCase().includes(lowerQuery) ||
        agent.description.toLowerCase().includes(lowerQuery) ||
        agent.capabilities.some(cap => cap.toLowerCase().includes(lowerQuery)) ||
        (agent.type?.toLowerCase().includes(lowerQuery) ?? false)
      );
    });
  }

  /**
   * Validate an agent file and return detailed results
   */
  async validateAgentFile(filePath: string): Promise<AgentValidationResult> {
    const result: AgentValidationResult = {
      valid: true,
      filePath,
      errors: [],
      warnings: [],
    };

    if (!existsSync(filePath)) {
      result.valid = false;
      result.errors.push(`File not found: ${filePath}`);
      return result;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = this.parseFrontmatter(content);

      if (!frontmatter) {
        result.valid = false;
        result.errors.push('No valid YAML frontmatter found (must be enclosed in ---)');
        return result;
      }

      // Check required fields
      if (!frontmatter.name && !basename(filePath, '.md')) {
        result.valid = false;
        result.errors.push('Missing required field: name');
      }

      // Check for description (both formats)
      if (!frontmatter.description && !frontmatter.metadata?.description) {
        result.warnings.push('Missing description field (recommended)');
      }

      // Check capabilities
      const caps = frontmatter.capabilities || frontmatter.metadata?.capabilities;
      if (!caps || (Array.isArray(caps) && caps.length === 0)) {
        result.warnings.push('No capabilities defined');
      }

      // Check for type
      if (!frontmatter.type) {
        result.warnings.push('No type specified (will use "custom")');
      }

      // Check for hooks format
      if (frontmatter.hooks) {
        if (frontmatter.hooks.pre && typeof frontmatter.hooks.pre !== 'string') {
          result.errors.push('hooks.pre must be a string');
          result.valid = false;
        }
        if (frontmatter.hooks.post && typeof frontmatter.hooks.post !== 'string') {
          result.errors.push('hooks.post must be a string');
          result.valid = false;
        }
      }

      // Check system prompt
      if (!body || body.trim().length === 0) {
        result.warnings.push('Empty system prompt (markdown body)');
      }

      // Try to parse as agent definition
      if (result.valid) {
        const agent = this.parseAgentFile(filePath, dirname(filePath));
        if (agent) {
          result.agent = agent;
        } else {
          result.valid = false;
          result.errors.push('Failed to parse agent definition');
        }
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Validate all agent files in search paths
   */
  async validateAllAgents(): Promise<AgentValidationResult[]> {
    const results: AgentValidationResult[] = [];

    for (const searchPath of this.searchPaths) {
      const files = this.findMarkdownFiles(searchPath);
      for (const filePath of files) {
        results.push(await this.validateAgentFile(filePath));
      }
    }

    return results;
  }

  /**
   * Get loading statistics
   */
  async getStats(): Promise<AgentLoadStats> {
    await this.ensureLoaded();
    const agents = await this.getAllAgents();

    const stats: AgentLoadStats = {
      totalLoaded: agents.length,
      customAgents: 0,
      builtInAgents: 0,
      byCategory: {},
      byType: {},
      errors: [...this.loadErrors],
    };

    for (const agent of agents) {
      if (agent.isCustom) {
        stats.customAgents++;
      } else {
        stats.builtInAgents++;
      }

      const category = agent.category || 'uncategorized';
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

      const type = agent.type || 'untyped';
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get the configured search paths
   */
  getSearchDirectories(): string[] {
    return [...this.searchPaths];
  }

  /**
   * Get any errors from the last load
   */
  getLoadErrors(): string[] {
    return [...this.loadErrors];
  }

  /**
   * Force reload of all agents
   */
  async refresh(): Promise<void> {
    this.lastLoadTime = 0;
    await this.loadAgents();
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.agentCache.clear();
    this.lastLoadTime = 0;
    this.loadErrors = [];
  }
}

// Singleton instance
export const customAgentLoader = new CustomAgentLoader();

// Convenience exports
export const getCustomAgent = (name: string) => customAgentLoader.getAgent(name);
export const getAllCustomAgents = () => customAgentLoader.getAllAgents();
export const getAvailableAgentNames = () => customAgentLoader.getAvailableAgentNames();
export const hasCustomAgent = (name: string) => customAgentLoader.hasAgent(name);
export const searchCustomAgents = (query: string) => customAgentLoader.searchAgents(query);
export const validateAgentFile = (path: string) => customAgentLoader.validateAgentFile(path);
export const validateAllAgents = () => customAgentLoader.validateAllAgents();
export const getAgentStats = () => customAgentLoader.getStats();
export const refreshCustomAgents = () => customAgentLoader.refresh();
