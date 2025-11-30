/**
 * Unified Agent Registry - Combines built-in agent types with custom agent definitions
 *
 * This registry provides a single source of truth for all available agents,
 * combining hardcoded built-in types with dynamically discovered custom agents.
 * Custom agents override built-in agents with the same name.
 */

import { customAgentLoader } from './custom-agent-loader.js';

/**
 * Built-in agent types with default capabilities
 * These are the hardcoded types that exist without .md files
 */
const BUILT_IN_AGENTS = [
  {
    name: 'coordinator',
    type: 'coordinator',
    description: 'Orchestrates tasks and manages workflow between agents',
    capabilities: ['Task Management', 'Workflow Orchestration', 'Resource Allocation', 'Coordination'],
    isBuiltIn: true,
  },
  {
    name: 'researcher',
    type: 'researcher',
    description: 'Gathers and analyzes information from various sources',
    capabilities: ['Research', 'Analysis', 'Information Gathering', 'Documentation'],
    isBuiltIn: true,
  },
  {
    name: 'coder',
    type: 'coder',
    description: 'Writes, reviews, and maintains code implementations',
    capabilities: ['Code Generation', 'Implementation', 'Refactoring', 'Debugging'],
    isBuiltIn: true,
  },
  {
    name: 'analyst',
    type: 'analyst',
    description: 'Performs data analysis and generates insights',
    capabilities: ['Data Analysis', 'Pattern Recognition', 'Reporting', 'Optimization'],
    isBuiltIn: true,
  },
  {
    name: 'architect',
    type: 'architect',
    description: 'Designs system architecture and technical solutions',
    capabilities: ['System Design', 'Architecture', 'Technical Planning', 'Integration'],
    isBuiltIn: true,
  },
  {
    name: 'tester',
    type: 'tester',
    description: 'Creates and executes tests, ensures quality',
    capabilities: ['Testing', 'Validation', 'Quality Assurance', 'Performance Testing'],
    isBuiltIn: true,
  },
  {
    name: 'reviewer',
    type: 'reviewer',
    description: 'Reviews code and documentation for quality and standards',
    capabilities: ['Code Review', 'Documentation Review', 'Standards Compliance', 'Feedback'],
    isBuiltIn: true,
  },
  {
    name: 'optimizer',
    type: 'optimizer',
    description: 'Optimizes performance and resource utilization',
    capabilities: ['Performance Optimization', 'Resource Management', 'Profiling', 'Tuning'],
    isBuiltIn: true,
  },
  {
    name: 'general',
    type: 'general',
    description: 'General-purpose agent for various tasks',
    capabilities: ['Research', 'Analysis', 'Code Generation'],
    isBuiltIn: true,
  },
];

/**
 * Unified Agent Registry class
 */
class UnifiedAgentRegistry {
  constructor() {
    this.builtInAgents = new Map(BUILT_IN_AGENTS.map(agent => [agent.name, agent]));
    this.initialized = false;
  }

  /**
   * Ensure the registry is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await customAgentLoader.refresh();
      this.initialized = true;
    }
  }

  /**
   * Get an agent by name
   * Custom agents take precedence over built-in agents
   */
  async getAgent(name) {
    await this.ensureInitialized();

    // First check custom agents (they override built-in)
    const customAgent = await customAgentLoader.getAgent(name);
    if (customAgent) {
      return customAgent;
    }

    // Fall back to built-in agent
    return this.builtInAgents.get(name) || null;
  }

  /**
   * Check if an agent exists
   */
  async hasAgent(name) {
    await this.ensureInitialized();
    return (await customAgentLoader.hasAgent(name)) || this.builtInAgents.has(name);
  }

  /**
   * Get all available agents (custom + built-in)
   * Custom agents override built-in agents with the same name
   */
  async getAllAgents() {
    await this.ensureInitialized();

    const result = new Map();

    // Add built-in agents first
    for (const [name, agent] of this.builtInAgents) {
      result.set(name, agent);
    }

    // Custom agents override built-in
    const customAgents = await customAgentLoader.getAllAgents();
    for (const agent of customAgents) {
      result.set(agent.name, agent);
    }

    return Array.from(result.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all agent names
   */
  async getAgentNames() {
    const agents = await this.getAllAgents();
    return agents.map(a => a.name);
  }

  /**
   * Get only built-in agents
   */
  getBuiltInAgents() {
    return Array.from(this.builtInAgents.values());
  }

  /**
   * Get only custom agents
   */
  async getCustomAgents() {
    await this.ensureInitialized();
    return customAgentLoader.getCustomAgents();
  }

  /**
   * Search agents by name, description, or capabilities
   */
  async searchAgents(query) {
    const allAgents = await this.getAllAgents();
    const lowerQuery = query.toLowerCase();

    return allAgents.filter(agent => {
      return (
        agent.name.toLowerCase().includes(lowerQuery) ||
        agent.description.toLowerCase().includes(lowerQuery) ||
        agent.capabilities.some(cap => cap.toLowerCase().includes(lowerQuery))
      );
    });
  }

  /**
   * Get agents by type
   */
  async getAgentsByType(type) {
    const allAgents = await this.getAllAgents();
    return allAgents.filter(agent => agent.type === type);
  }

  /**
   * Get capabilities for an agent
   * Returns custom capabilities if available, otherwise default capabilities
   */
  async getAgentCapabilities(name) {
    const agent = await this.getAgent(name);
    if (agent) {
      return agent.capabilities;
    }
    // Default capabilities for unknown agents
    return ['Research', 'Analysis', 'Code Generation'];
  }

  /**
   * Get system prompt for a custom agent (if available)
   */
  async getAgentSystemPrompt(name) {
    const customAgent = await customAgentLoader.getAgent(name);
    return customAgent?.systemPrompt || null;
  }

  /**
   * Get hooks for an agent
   */
  async getAgentHooks(name) {
    const customAgent = await customAgentLoader.getAgent(name);
    return customAgent?.hooks || null;
  }

  /**
   * Refresh the registry (reload custom agents)
   */
  async refresh() {
    await customAgentLoader.refresh();
    this.initialized = true;
  }

  /**
   * Get registry statistics
   */
  async getStats() {
    await this.ensureInitialized();

    const customAgents = await customAgentLoader.getAllAgents();
    const customNames = new Set(customAgents.map(a => a.name));

    const overriddenBuiltIns = Array.from(this.builtInAgents.keys()).filter(name =>
      customNames.has(name)
    );

    return {
      totalAgents: this.builtInAgents.size + customAgents.length - overriddenBuiltIns.length,
      builtInCount: this.builtInAgents.size,
      customCount: customAgents.length,
      overriddenBuiltIns,
    };
  }

  /**
   * Check if an agent is custom (vs built-in)
   */
  async isCustomAgent(name) {
    return customAgentLoader.hasAgent(name);
  }

  /**
   * Get the source path for a custom agent
   */
  async getAgentSourcePath(name) {
    const customAgent = await customAgentLoader.getAgent(name);
    return customAgent?.sourcePath || null;
  }
}

// Singleton instance
export const unifiedAgentRegistry = new UnifiedAgentRegistry();

// Convenience exports
export const getAgent = (name) => unifiedAgentRegistry.getAgent(name);
export const hasAgent = (name) => unifiedAgentRegistry.hasAgent(name);
export const getAllAgents = () => unifiedAgentRegistry.getAllAgents();
export const getAgentNames = () => unifiedAgentRegistry.getAgentNames();
export const searchAgents = (query) => unifiedAgentRegistry.searchAgents(query);
export const getAgentCapabilities = (name) => unifiedAgentRegistry.getAgentCapabilities(name);
export const getAgentSystemPrompt = (name) => unifiedAgentRegistry.getAgentSystemPrompt(name);
export const getAgentHooks = (name) => unifiedAgentRegistry.getAgentHooks(name);
export const refreshRegistry = () => unifiedAgentRegistry.refresh();
export const getRegistryStats = () => unifiedAgentRegistry.getStats();
export const isCustomAgent = (name) => unifiedAgentRegistry.isCustomAgent(name);

// Export the built-in agent list for reference
export { BUILT_IN_AGENTS };
