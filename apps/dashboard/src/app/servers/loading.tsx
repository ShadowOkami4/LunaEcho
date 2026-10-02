import { PageSkeleton } from "@/components/page-skeleton";

export default function ServersLoading() {
  return <PageSkeleton cards={6} grid label="Loading your servers" />;
}
