/**
 * One error class for everything the SDK throws, so a caller branches on
 * `err.type` and `err.code` instead of parsing messages. Mirrors the 0.3.0
 * error model on the metropolis/sdk branch.
 */

export type PolarisErrorType =
  | "configuration_error"
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "idempotency_error"
  | "rate_limit_error"
  | "api_error"
  | "connection_error"
  | "signature_verification_error"
  | "checkout_error"
  | "wallet_error";

export type PolarisErrorOptions = {
  type: PolarisErrorType;
  code: string;
  status?: number;
  requestId?: string;
  param?: string;
  cause?: unknown;
};

export class PolarisError extends Error {
  readonly type: PolarisErrorType;
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly param?: string;

  constructor(message: string, options: PolarisErrorOptions) {
    super(message);
    this.name = "PolarisError";
    this.type = options.type;
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.param = options.param;
    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", { value: options.cause, enumerable: false, configurable: true });
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Why a webhook signature failed, for logs. Never echo it to whoever called your endpoint. */
export type SignatureFailureReason =
  | "missing_header"
  | "malformed_header"
  | "no_signatures"
  | "timestamp_outside_tolerance"
  | "signature_mismatch"
  | "missing_secret"
  | "invalid_payload";

export class PolarisSignatureVerificationError extends PolarisError {
  readonly reason: SignatureFailureReason;

  constructor(reason: SignatureFailureReason, message: string) {
    super(message, { type: "signature_verification_error", code: `webhook_${reason}` });
    this.name = "PolarisSignatureVerificationError";
    this.reason = reason;
  }
}

export function isPolarisError(value: unknown): value is PolarisError {
  return value instanceof PolarisError;
}

export function configurationError(code: string, message: string, param?: string): PolarisError {
  return new PolarisError(message, { type: "configuration_error", code, param });
}

export function invalidRequest(code: string, message: string, param?: string): PolarisError {
  return new PolarisError(message, { type: "invalid_request_error", code, param });
}

export function walletError(code: WalletErrorCode, message: string, cause?: unknown): PolarisError {
  return new PolarisError(message, { type: "wallet_error", code, cause });
}

/** The wallet failures `pay()` distinguishes, so a button can say what to do next. */
export type WalletErrorCode =
  | "no_wallet"
  | "user_rejected"
  | "wrong_network"
  | "not_deployed"
  | "relay_failed"
  | "unknown_wallet_error";
