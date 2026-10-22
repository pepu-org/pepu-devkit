export * from "./policy.js";

// Pure Kernel session helpers: no @zerodev/* needed (also exported from /session/kernel).
export { checkApproval, describeKernelSessionScope, isCallInScope, parseApproval } from "./scope.js";
export type { ApprovalCheck, KernelSessionCall, KernelSessionScope, ParsedApproval } from "./scope.js";
