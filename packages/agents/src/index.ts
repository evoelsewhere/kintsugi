// @kintsugi/agents — agent packages (ADR-0026, ADR-0027): Claude Code style agent files
// plus Agent Skills, validation against an installation, conversion of runtime agents to
// the kernel's AgentDefinition, and the built-in modernization content shipped with
// Kintsugi (builtin/).

export {
  AGENT_AUDIENCES,
  agentFileName,
  parseAgentFile,
  SKILL_FILE,
  parseAgentPackage,
  parseSkill,
  parseSkillLibrary,
  serializeAgentPackage,
  serializeSkill,
  type AgentAudience,
  type AgentManifest,
  type AgentPackage,
  type PackageFiles,
  type Parsed,
  type SkillPackage,
} from "./format.js";
export { toAgentDefinition, validateAgent, type AgentContext } from "./definition.js";
export { BUILTIN_DIR, builtinPluginDirs, findBuiltinFile, loadBuiltinCatalog, readPackageDir, type BuiltinCatalog, type BuiltinPluginDir } from "./builtin.js";
export {
  loadBuiltinPlugins,
  PLUGIN_MANIFEST_FILE,
  readBuiltinPluginFile,
  type BuiltinPlugin,
  type PluginAudience,
  type PluginComponent,
  type PluginComponentKind,
  type PluginFile,
  type PluginFlow,
  type PluginFlowStep,
  type PluginLink,
} from "./plugins.js";
export { flowComponents, parseFlow, type FlowNode } from "./flow.js";
export { COMMAND_AUDIENCES, COMMAND_ORDER, loadBuiltinCommands, type BuiltinCommand, type CommandAudience } from "./commands.js";
export {
  AgentResolutionError,
  installationSkills,
  parseStoredAgent,
  resolveAgent,
  resolveAgentDefinition,
  type AgentSource,
  type CustomAgentStore,
  type ResolvedAgent,
  type Resolution,
  type ResolveOptions,
  type StoredAgent,
  type StoredSkill,
} from "./catalog.js";
export { unzipFiles, zipFiles, type UnzipLimits } from "./zip.js";

export { MAX_UNIT_DOCUMENT_BYTES, parseUnitDocument } from "./unit-document.js";
