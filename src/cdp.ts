/** Envoltura tipada y minima sobre chrome.debugger (Chrome DevTools Protocol). */

export const CDP_VERSION = "1.3";

export type Debuggee = chrome.debugger.Debuggee;

export async function attach(tabId: number): Promise<Debuggee> {
  const target: Debuggee = { tabId };
  await chrome.debugger.attach(target, CDP_VERSION);
  return target;
}

export async function detach(target: Debuggee): Promise<void> {
  try {
    await chrome.debugger.detach(target);
  } catch {
    // La pestana pudo cerrarse o el usuario pudo detener el depurador.
  }
}

export async function sendCommand<T>(
  target: Debuggee,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const result = await chrome.debugger.sendCommand(target, method, params ?? {});
  return (result ?? null) as unknown as T;
}

interface EvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/** Ejecuta una expresion en la pagina y devuelve su valor serializado. */
export async function evaluate<T>(target: Debuggee, expression: string): Promise<T> {
  const response = await sendCommand<EvaluateResult>(target, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: false,
  });

  if (response?.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "error";
    throw new Error(detail);
  }

  return (response?.result?.value ?? null) as T;
}
