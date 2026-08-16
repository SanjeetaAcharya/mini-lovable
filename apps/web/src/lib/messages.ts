/**
 * Maps API failures to language a user can act on.
 *
 * The API's own error strings are diagnostics written for whoever is
 * reading the server logs — "JSON parse error: Unterminated string in JSON
 * at position 5204" tells a developer exactly what happened and tells a
 * user nothing except that something is broken. The raw text is kept as
 * `detail` so it stays available behind a toggle for anyone debugging,
 * but it is never the primary message.
 *
 * Where the user did not get what they paid for, the copy says so
 * explicitly: failed generations and failed deploys are not charged
 * (see routes/generate.ts and routes/deploy.ts), and saying it up front
 * answers the question a user would otherwise have to ask.
 */
export interface UserFacingError {
  /** Plain language, safe to show as the primary message. */
  message: string;
  /** Raw server diagnostic. Only for a collapsed "details" toggle. */
  detail?: string;
}

/** Joins the server's error/reason pair into one diagnostic string. */
function joinDetail(error: string, extra?: string): string | undefined {
  const combined = extra ? `${error}: ${extra}` : error;
  return combined.trim() === "" ? undefined : combined;
}

export function generationErrorMessage(
  status: number,
  error: string,
  reason?: string
): UserFacingError {
  const detail = joinDetail(error, reason);

  // 400 responses come from this app's own prompt validation, and are
  // already written for the user — pass them straight through.
  if (status === 400) {
    return { message: error };
  }

  // The request never reached the server at all.
  if (status === 0) {
    return { message: "Couldn't reach the server. Check your connection and try again.", detail };
  }

  if (status === 502) {
    // The model replied but the output couldn't be used (bad JSON, missing
    // index.html, unsafe paths). Distinguished from a transport failure by
    // the presence of a `reason`, which only the invalid-output path sets.
    if (reason) {
      return {
        message: "The model returned an unusable response. You weren't charged. Please try again.",
        detail,
      };
    }
    return {
      message: "Couldn't reach the model provider. You weren't charged. Please try again.",
      detail,
    };
  }

  return { message: "Something went wrong generating your site. You weren't charged. Please try again.", detail };
}

export function deploymentErrorMessage(
  status: number,
  error: string,
  message?: string
): UserFacingError {
  const detail = joinDetail(error, message);

  if (status === 0) {
    return { message: "Couldn't reach the server. Check your connection and try again.", detail };
  }
  if (status === 404 || status === 400) {
    return { message: "That site isn't available to deploy.", detail };
  }
  if (status === 409) {
    return { message: "This site has already been deployed.", detail };
  }
  if (status === 422) {
    // Sandbox validation rejected the files. Deterministic for a given
    // generation, so "try again" would be misleading — the same files
    // fail the same way. Regenerating is the only path forward.
    return {
      message:
        "The generated site didn't pass safety validation, so it wasn't deployed. You weren't charged. Try generating it again.",
      detail,
    };
  }
  return { message: "Deployment failed. You weren't charged. Please try again.", detail };
}

export function checkoutErrorMessage(raw: string): UserFacingError {
  return { message: "Couldn't start checkout. Please try again.", detail: raw };
}
