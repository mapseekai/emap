/** @module ai */
export { CapabilityRegistry } from './registry';
export {
  describeAgentTools,
  invokeAgentTool,
  summarizeCapabilityResult,
} from './agent-tools';
export { validateCapabilityInput } from './schema';
export type {
  CapabilityAuthorizer,
  CapabilityAuthorization,
  CapabilityCallContext,
  CapabilityDefinition,
  CapabilityDescriptor,
  CapabilityEffect,
  CapabilityInvocation,
  CapabilityOrigin,
  CapabilityRegistryContract,
  CapabilityRun,
  InputSchema,
} from '../services/capabilities';
