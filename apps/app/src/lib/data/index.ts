import type { Address } from "viem";
import { apiConfigured } from "../api";
import { liveData } from "./live";
import { mockData } from "./mock";
import { getRemotePaymentLink, isRemoteLinkId } from "./remote";
import type { PolarisData } from "./types";

export type * from "./types";
export { DAY, describeDuration, describeInterval, quotePlan, WEEK } from "./quote";

/**
 * The one data source every screen reads through. With Polaris for Business
 * configured it is the real one (`live.ts`: the chain, and the API's records
 * of chain events); without it, the offline demo's sample data (`mock.ts`),
 * which the app labels as a demo (`DEMO_MODE`).
 */
export const data: PolarisData = apiConfigured() ? liveData : mockData;

/** Sample payment links for the Pay screen. Empty once real links exist. */
export { DEMO_LINK_IDS as SAMPLE_LINK_IDS } from "./mock";

export const getProfile = (owner: Address | null) => data.getProfile(owner);
export const getBalance = (owner: Address | null) => data.getBalance(owner);
export const getCreditLine = (owner: Address | null) => data.getCreditLine(owner);
export const getPlans = (owner: Address | null) => data.getPlans(owner);
export const getActivity = (owner: Address | null) => data.getActivity(owner);
export const getContacts = (owner: Address | null) => data.getContacts(owner);
/** Checkout sessions (`cs_…`) and payment links (`pl_…`) come from Polaris for Business; sample slugs from the sample data. */
export const getPaymentLink = (id: string) => (apiConfigured() && isRemoteLinkId(id) ? getRemotePaymentLink(id) : data.getPaymentLink(id));
export const getSendLink = (linkKey: Address) => data.getSendLink(linkKey);
