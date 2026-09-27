/**
 * Sample data switches. Everything that isn't backed by a live service yet is
 * either empty or labelled "Sample": nothing sample ever reads as live.
 */

/**
 * The server seeds each new merchant with a deterministic sample book
 * (payments, plans, payouts, links) only when this is on. Off by default, so a
 * real merchant starts with an empty dashboard. Public, so the browser knows to
 * label what it shows.
 */
export const SERVER_DEMO_DATA = process.env.NEXT_PUBLIC_POLARIS_DEMO_DATA === "1";
