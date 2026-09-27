import type { Address } from "viem";
import { apiConfigured } from "../api";
import { mockData } from "./mock";
import { getRemotePaymentLink, isRemoteLinkId } from "./remote";
import type { PolarisData } from "./types";

export type * from "./types";
export { DAY, describeDuration, describeInterval, dueAt, quotePlan, WEEK } from "./quote";

/**
 * The one data source every screen reads through. Today it is placeholder
 * data (`mock.ts`); a later step points it at chain reads and the Envio
 * indexer, keeping this interface, so no screen changes.
 */
export const data: PolarisData = mockData;

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
