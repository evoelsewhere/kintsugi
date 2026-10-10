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
export { BUILTIN_DIR, loadBuiltinCatalog, readPackageDir, type BuiltinCatalog } from "./builtin.js";
