"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { AlertIcon } from "@/components/icons";
import { FLAT_SHIPPING, FREE_SHIPPING_THRESHOLD, getOption, getProduct } from "@/lib/catalog";
import { CheckoutError, fetchOrder, logBrowserCalls, newAttemptId, placeOrder, type CheckoutPayload } from "@/lib/checkout-client";
import { PolarisCheckoutButton, PolarisPayButton, isPolarisError, type CheckoutResult, type PayButtonState } from "@/lib/polaris-client";
import { useShop } from "@/lib/shop-context";

import { ContactFields, DEMO_BUYER, validateBuyer, type BuyerForm } from "./contact-fields";
import { OrderSummary, type SummaryLine } from "./order-summary";
import { PaymentOptions, type Method, type Mode } from "./payment-options";
import { ACTIVE_STEP, WalletSteps } from "./wallet-steps";

type Notice = { tone: "info" | "error"; text: string } | null;

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
  const [walletState, setWalletState] = useState<PayButtonState | "confirming" | "paid">("idle");
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
      if (result.status === "complete" && session) {
        // The receipt empties the bag once the order is paid.
        router.push(`/orders/${session.orderId}?via=polaris`);
      } else if (result.status === "canceled") {
        setNotice({ tone: "info", text: "You canceled in Polaris. Nothing was charged. Choose another way to pay, or try again." });
      } else if (result.status === "closed") {
        setNotice({ tone: "info", text: "The Polaris window closed before you finished. Nothing was charged; you can pick up where you left off." });
      }
    },
    [router],
  );

  const onCheckoutError = useCallback((e: Error) => {
    if (e instanceof CheckoutError && e.code === "already_paid") return;
    setNotice({ tone: "error", text: isPolarisError(e) && e.type === "configuration_error" ? "Polaris isn't set up correctly on this store." : e.message });
  }, []);

  const walletOrder = useRef<string | null>(null);
  const prepareWallet = useCallback(async () => {
    setWalletError(null);
    if (!valid) {
      setTouched(true);
      throw new CheckoutError("Fill in your details first.", "invalid");
    }
    const res = await place({ method: "wallet" });
    if (!res.wallet) {
      if (res.order.status !== "awaiting_payment") router.push(`/orders/${res.order.id}`);
      throw new CheckoutError("This order can't be paid from a wallet.", "no_wallet_payment");
    }
    walletOrder.current = res.order.id;
    setCurrentOrderId(res.order.id);
    return { orderId: res.wallet.orderId, merchant: res.wallet.merchant, amount: res.wallet.amount };
  }, [valid, place, router, setCurrentOrderId]);

  const onWalletState = useCallback((state: PayButtonState, error?: Error) => {
    setWalletState(state);
    const step = ACTIVE_STEP[state];
    if (step !== undefined) setWalletStep(step);
    if (!error) return;
    if (isPolarisError(error)) {
      const messages: Record<string, string> = {
        user_rejected: "You declined in your wallet. Nothing was charged.",
        wrong_network: "Your wallet is on another network. Switch it to Monad Testnet, then try again.",
        no_wallet: "There's no wallet in this browser. Install one, or pay with Polaris instead.",
        relay_failed: `Polaris couldn't send the payment: ${error.message}`,
        not_deployed: "Direct payments aren't live on this network yet. Pay with Polaris instead.",
      };
      setWalletError(messages[error.code] ?? error.message);
    } else {
      setWalletError(error.message);
    }
  }, []);

  const onWalletSubmitted = useCallback(
    async (result: { txHash: string; paymentId: string; payer: string; relayed: boolean; orderId: string }) => {
      logBrowserCalls(result.orderId, [
        {
          at: new Date().toISOString(),
          call: "polaris.pay",
          args: [{ merchant: "(from /api/checkout)", amount: (total / 100).toFixed(2), orderId: result.orderId }],
          result: { status: "submitted", txHash: result.txHash, paymentId: result.paymentId, relayed: result.relayed },
        },
      ]);
      setWalletState("confirming");
      // Paid comes from the webhook, never from here: wait for the store to hear it.
      for (let i = 0; i < 90; i++) {
        const latest = await fetchOrder(result.orderId);
        if (latest?.order.status === "paid") {
          setWalletState("paid");
          window.setTimeout(() => router.push(`/orders/${result.orderId}?via=wallet`), 1600);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      router.push(`/orders/${result.orderId}?via=wallet`);
    },
    [total, router],
  );

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
                  walletState !== "idle" || walletError ? <WalletSteps state={walletState} error={walletError} lastStep={walletStep} /> : null
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
                  <PolarisCheckoutButton
                    polaris={polaris}
                    session={createSession}
                    disabled={!valid}
                    onResult={onCheckoutResult}
                    onError={onCheckoutError}
                    onClickCapture={() => setTouched(true)}
                  >
                    {polarisLabel}
                  </PolarisCheckoutButton>
                ) : (
                  <PolarisPayButton
                    polaris={polaris}
                    amount={(total / 100).toFixed(2)}
                    prepare={prepareWallet}
                    disabled={!valid || walletState === "confirming" || walletState === "paid"}
                    onStateChange={onWalletState}
                    onSubmitted={onWalletSubmitted}
                  />
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
