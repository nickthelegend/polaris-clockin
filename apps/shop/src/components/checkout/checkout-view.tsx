"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { AlertIcon, CheckIcon, Spinner, WalletIcon } from "@/components/icons";
import { FLAT_SHIPPING, FREE_SHIPPING_THRESHOLD, getOption, getProduct } from "@/lib/catalog";
import { formatUsd } from "@/lib/money";
import { CheckoutError, fetchOrder, logBrowserCalls, newAttemptId, placeOrder, type CheckoutPayload } from "@/lib/checkout-client";
import { PolarisCheckoutButton, isPolarisError, type CheckoutResult, type PayResult, type PolarisError } from "@/lib/polaris-client";
import { useShop } from "@/lib/shop-context";

import { ContactFields, DEMO_BUYER, validateBuyer, type BuyerForm } from "./contact-fields";
import { OrderSummary, type SummaryLine } from "./order-summary";
import { PaymentOptions, type Method, type Mode } from "./payment-options";
import { ACTIVE_STEP, WalletSteps, type WalletPhase } from "./wallet-steps";

type Notice = { tone: "info" | "error"; text: string } | null;

const WALLET_LABEL: Partial<Record<WalletPhase, string>> = {
  connecting: "Connecting your wallet…",
  signing: "Confirm in your wallet…",
  submitting: "Sending, gas-free…",
  confirming: "Confirming on Monad…",
  waiting: "Waiting for Polaris…",
  paid: "Paid",
  error: "Try again",
};

export function CheckoutView({
  subscription,
  returnedFromCancel,
}: {
  subscription: { productId: string; optionId: string } | null;
  returnedFromCancel: boolean;
}) {
  const shop = useShop();
  const router = useRouter();
  const { polaris, polarisConfig, setCurrentOrderId } = shop;

  const lines: SummaryLine[] = useMemo(() => {
    if (subscription) {
      const product = getProduct(subscription.productId)!;
      const option = getOption(product, subscription.optionId)!;
      return [{ productId: product.id, optionId: option.id, quantity: 1, product, option, lineTotal: product.price }];
    }
    return shop.lines;
  }, [subscription, shop.lines]);

  const kind = subscription ? "subscription" : "one_time";
  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
  const shipping = kind === "subscription" || subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  const total = subtotal + shipping;

  const [buyer, setBuyer] = useState<BuyerForm>(DEMO_BUYER);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<Method>("polaris");
  const [mode, setMode] = useState<Mode>(subscription ? "subscribe" : "later");
  const [notice, setNotice] = useState<Notice>(
    returnedFromCancel ? { tone: "info", text: "You left Polaris without paying. Nothing was charged, and your bag is as you left it." } : null,
  );
  const [walletState, setWalletState] = useState<WalletPhase>("idle");
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletStep, setWalletStep] = useState(0);
  const [attemptId, setAttemptId] = useState(newAttemptId);
  const sessionRef = useRef<{ orderId: string; url: string; openedAt: string } | null>(null);

  const clientErrors = validateBuyer(buyer);
  const errors = { ...(touched ? clientErrors : {}), ...serverErrors };
  const valid = Object.keys(clientErrors).length === 0 && lines.length > 0;

  const payload = useCallback(
    (payment: CheckoutPayload["payment"]): CheckoutPayload => ({
      items: lines.map((l) => ({ productId: l.productId, optionId: l.optionId, quantity: l.quantity })),
      contact: { email: buyer.email, ...(buyer.phone ? { phone: buyer.phone } : {}) },
      address: {
        name: buyer.name,
        line1: buyer.line1,
        ...(buyer.line2 ? { line2: buyer.line2 } : {}),
        city: buyer.city,
        postalCode: buyer.postalCode,
        country: buyer.country,
      },
      payment,
    }),
    [lines, buyer],
  );

  const place = useCallback(
    async (payment: CheckoutPayload["payment"]) => {
      setServerErrors({});
      setNotice(null);
      try {
        return await placeOrder(payload(payment), attemptId);
      } catch (e) {
        if (e instanceof CheckoutError) {
          if (e.code === "idempotency_conflict") {
            const fresh = newAttemptId();
            setAttemptId(fresh);
            return placeOrder(payload(payment), fresh);
          }
          setServerErrors(e.fields);
          setTouched(true);
        }
        throw e;
      }
    },
    [payload, attemptId],
  );

  const createSession = useCallback(async () => {
    const openedAt = new Date().toISOString();
    const res = await place({ method: "polaris", mode });
    if (res.order.status !== "awaiting_payment") {
      router.push(`/orders/${res.order.id}`);
      throw new CheckoutError("This order is already paid.", "already_paid");
    }
    if (!res.checkout) throw new CheckoutError("Polaris didn't return a checkout.", "no_session");
    sessionRef.current = { orderId: res.order.id, url: res.checkout.url, openedAt };
    setCurrentOrderId(res.order.id);
    return { id: res.checkout.sessionId, url: res.checkout.url };
  }, [place, mode, router, setCurrentOrderId]);

  const onCheckoutResult = useCallback(
    (result: CheckoutResult) => {
      const session = sessionRef.current;
      if (session) {
        logBrowserCalls(session.orderId, [
          { at: session.openedAt, call: "polaris.openCheckout", args: [session.url], result },
        ]);
      }
      if (result.status === "completed" && session) {
        // The receipt empties the bag once the order is paid.
        router.push(`/orders/${session.orderId}?via=polaris`);
      } else if (result.status === "canceled") {
        setNotice({ tone: "info", text: "You canceled in Polaris. Nothing was charged. Choose another way to pay, or try again." });
      } else if (result.status === "closed") {
        setNotice({ tone: "info", text: "The Polaris window closed before you finished. Nothing was charged; you can pick up where you left off." });
      } else if (result.status === "expired" || result.status === "timeout") {
        setNotice({ tone: "info", text: "That Polaris checkout expired. Nothing was charged; start again when you're ready." });
      }
    },
    [router],
  );

  const onCheckoutError = useCallback((e: PolarisError | Error) => {
    const cause = (e as { cause?: unknown }).cause ?? e;
    if ((cause instanceof CheckoutError && cause.code === "already_paid") || (e instanceof CheckoutError && e.code === "already_paid")) return;
    setNotice({ tone: "error", text: isPolarisError(e) && e.type === "configuration_error" ? "Polaris isn't set up correctly on this store." : e.message });
  }, []);

  const moveWallet = useCallback((phase: WalletPhase) => {
    setWalletState(phase);
    const step = ACTIVE_STEP[phase];
    if (step !== undefined) setWalletStep(step);
  }, []);

  /**
   * Direct wallet payment: the store creates the order (its id is what the
   * buyer signs for), then polaris.pay() asks the wallet for one ERC-3009
   * signature and the Polaris relayer submits it. Paid still only comes from
   * the webhook.
   */
  const payFromWallet = useCallback(async () => {
    if (!polaris) return;
    setWalletError(null);
    setTouched(true);
    if (!valid) return;
    moveWallet("connecting");
    let res;
    try {
      res = await place({ method: "wallet" });
    } catch (e) {
      moveWallet("error");
      setWalletError((e as Error).message);
      return;
    }
    if (!res.wallet) {
      if (res.order.status !== "awaiting_payment") router.push(`/orders/${res.order.id}`);
      moveWallet("error");
      setWalletError("This order can't be paid from a wallet.");
      return;
    }
    const { merchant, amount, orderId } = res.wallet;
    setCurrentOrderId(orderId);
    const startedAt = new Date().toISOString();

    let result: PayResult;
    try {
      result = await polaris.pay({ merchant, amount, orderId, onStage: (stage) => moveWallet(stage) });
    } catch (e) {
      // Setup mistakes throw (an undeployed contract); the buyer's own problems come back as a result.
      result = { ok: false, error: (e as Error).message, cause: e };
    }
    logBrowserCalls(orderId, [
      {
        at: startedAt,
        call: "polaris.pay",
        args: [{ merchant, amount, orderId }],
        result: result.ok
          ? { ok: true, transactionHash: result.transactionHash, paymentId: result.paymentId, relayed: result.relayed }
          : { ok: false, error: result.error },
      },
    ]);
    if (!result.ok) {
      moveWallet("error");
      setWalletError(result.error ?? "The payment didn't go through. Nothing was charged.");
      return;
    }

    moveWallet("waiting");
    // Paid comes from the webhook, never from here: wait for the store to hear it.
    for (let i = 0; i < 90; i++) {
      const latest = await fetchOrder(orderId);
      if (latest?.order.status === "paid") {
        moveWallet("paid");
        window.setTimeout(() => router.push(`/orders/${orderId}?via=wallet`), 1600);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    router.push(`/orders/${orderId}?via=wallet`);
  }, [polaris, valid, place, router, setCurrentOrderId, moveWallet]);

  if (!shop.ready && !subscription) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-10 lg:pt-14" aria-busy="true">
        <h1 className="display text-[2.8rem] sm:text-[3.6rem]">Checkout</h1>
      </div>
    );
  }

  if (shop.ready && lines.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 pt-16 sm:px-6 lg:px-10">
        <h1 className="display text-[3rem] sm:text-[4rem]">Checkout</h1>
        <p className="mt-4 text-muted">Your bag is empty.</p>
        <Link href="/shop" className="btn btn-ink mt-8">
          Shop the collection
        </Link>
      </div>
    );
  }

  const testMode = polarisConfig.ok && polarisConfig.publishableKey.startsWith("pk_test_");
  const busyWallet = walletState !== "idle" && walletState !== "error" && walletState !== "paid";
  const polarisLabel =
    mode === "later" ? "Continue to Pay in 4" : mode === "subscribe" ? "Subscribe with Polaris" : "Pay with Polaris";

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-10 lg:pt-14">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="display text-[2.8rem] sm:text-[3.6rem]">Checkout</h1>
            {testMode ? (
              <span className="rounded-full bg-sand px-3 py-1 text-[0.8rem] text-ink-2">Test mode · no real money moves</span>
            ) : null}
          </div>

          <div className="mt-6 lg:hidden">
            <OrderSummary lines={lines} subtotal={subtotal} shipping={shipping} total={total} mode={method === "polaris" ? mode : null} aprBps={polarisConfig.payInFourAprBps} collapsible />
          </div>

          <form
            noValidate
            onSubmit={(e) => e.preventDefault()}
            className="mt-8"
            aria-describedby={notice ? "checkout-notice" : undefined}
          >
            <ContactFields value={buyer} errors={errors} onChange={(next) => { setBuyer(next); setServerErrors({}); }} onBlur={() => setTouched(true)} />

            <section aria-labelledby="payment-title" className="mt-12">
              <h2 id="payment-title" className="display text-[1.9rem]">
                Payment
              </h2>
              <p className="mt-1 text-[0.95rem] text-muted">Every payment is confirmed before anything ships.</p>

              <PaymentOptions
                method={method}
                onMethod={(m) => {
                  setMethod(m);
                  setNotice(null);
                }}
                mode={mode}
                onMode={setMode}
                kind={kind}
                total={total}
                aprBps={polarisConfig.payInFourAprBps}
                walletPanel={
                  walletState !== "idle" || walletError ? <WalletSteps phase={walletState} error={walletError} lastStep={walletStep} /> : null
                }
              />

              {errors.payment ? (
                <p className="mt-4 text-[0.92rem] text-alert" role="alert">
                  {errors.payment}
                </p>
              ) : null}

              <div className="mt-6">
                {!polarisConfig.ok ? (
                  <p className="rounded-xl bg-alert-soft p-4 text-[0.95rem] text-alert" role="alert">
                    Payments are switched off on this store right now.
                  </p>
                ) : method === "polaris" ? (
                  <div onClickCapture={() => setTouched(true)}>
                    <PolarisCheckoutButton
                      polaris={polaris ?? undefined}
                      createSession={createSession}
                      disabled={!valid || !polaris}
                      installments={false}
                      label={polarisLabel}
                      size="lg"
                      onResult={onCheckoutResult}
                      onError={onCheckoutError}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={payFromWallet}
                    disabled={!polaris || busyWallet}
                    aria-busy={busyWallet || undefined}
                    className="btn btn-ink h-[3.75rem] w-full text-[1rem]"
                  >
                    {busyWallet ? <Spinner size={18} /> : walletState === "paid" ? <CheckIcon size={18} /> : <WalletIcon size={20} />}
                    {WALLET_LABEL[walletState] ?? `Pay ${formatUsd(total)} from your wallet`}
                  </button>
                )}
                {!valid && touched ? <p className="mt-3 text-[0.9rem] text-alert">Fill in the details above to continue.</p> : null}
              </div>

              <div id="checkout-notice" aria-live="polite">
                {notice ? (
                  <p
                    className={`mt-5 flex gap-3 rounded-xl p-4 text-[0.95rem] ${notice.tone === "error" ? "bg-alert-soft text-alert" : "bg-sand text-ink-2"}`}
                  >
                    <AlertIcon size={20} className="mt-0.5 shrink-0" />
                    {notice.text}
                  </p>
                ) : null}
              </div>
            </section>
          </form>
        </div>

        <aside aria-label="Order summary" className="hidden lg:col-span-5 lg:block">
          <div className="lg:sticky lg:top-24">
            <OrderSummary lines={lines} subtotal={subtotal} shipping={shipping} total={total} mode={method === "polaris" ? mode : null} aprBps={polarisConfig.payInFourAprBps} />
          </div>
        </aside>
      </div>
    </div>
  );
}
