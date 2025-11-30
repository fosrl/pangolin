import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import ResourcesTable, {
  ResourceRow,
  InternalResourceRow
} from "../../../../components/ResourcesTable";
import { AxiosResponse } from "axios";
import { ListResourcesResponse } from "@server/routers/resource";
import { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { redirect } from "next/navigation";
import { cache } from "react";
import { GetOrgResponse } from "@server/routers/org";
import OrgProvider from "@app/providers/OrgProvider";
import { getTranslations } from "next-intl/server";
import { pullEnv } from "@app/lib/pullEnv";
import { toUnicode } from "punycode";

type ResourcesPageProps = {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export const dynamic = "force-dynamic";

export default async function ResourcesPage(props: ResourcesPageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const t = await getTranslations();

  const env = pullEnv();

  // Default to 'proxy' view, or use the query param if provided
  let defaultView: "proxy" | "internal" = "proxy";
  if (env.flags.enableClients) {
    defaultView = searchParams.view === "internal" ? "internal" : "proxy";
  }

  let resources: ListResourcesResponse["resources"] = [];
  try {
    const res = await internal.get<AxiosResponse<ListResourcesResponse>>(
      `/org/${params.orgId}/resources`,
      await authCookieHeader()
    );
    resources = res.data.data.resources;
  } catch (e) { }

  let siteResources: ListAllSiteResourcesByOrgResponse["siteResources"] = [];
  try {
    const res = await internal.get<
      AxiosResponse<ListAllSiteResourcesByOrgResponse>
    >(`/org/${params.orgId}/site-resources`, await authCookieHeader());
    siteResources = res.data.data.siteResources;
  } catch (e) { }

  let org = null;
  try {
    const getOrg = cache(async () =>
      internal.get<AxiosResponse<GetOrgResponse>>(
        `/org/${params.orgId}`,
        await authCookieHeader()
      )
    );
    const res = await getOrg();
    org = res.data.data;
  } catch {
    redirect(`/${params.orgId}/settings/resources`);
  }

  if (!org) {
    redirect(`/${params.orgId}/settings/resources`);
  }

  const resourceRows: ResourceRow[] = resources.map((resource) => {
    return {
      id: resource.resourceId,
      name: resource.name,
      orgId: params.orgId,
      nice: resource.niceId,
      domain: `${resource.ssl ? "https://" : "http://"}${toUnicode(resource.fullDomain || "")}`,
      protocol: resource.protocol,
      proxyPort: resource.proxyPort,
      http: resource.http,
      authState: !resource.http
        ? "none"
        : resource.sso ||
          resource.pincodeId !== null ||
          resource.passwordId !== null ||
          resource.whitelist ||
          resource.headerAuthId
          ? "protected"
          : "not_protected",
      enabled: resource.enabled,
      domainId: resource.domainId || undefined,
      ssl: resource.ssl,
      targets: resource.targets?.map(target => ({
        targetId: target.targetId,
        ip: target.ip,
        port: target.port,
        enabled: target.enabled,
        healthStatus: target.healthStatus
      }))
    };
  });

  const internalResourceRows: InternalResourceRow[] = siteResources.map(
    (siteResource) => {
      return {
        id: siteResource.siteResourceId,
        name: siteResource.name,
        orgId: params.orgId,
        siteName: siteResource.siteName,
        protocol: siteResource.protocol,
        proxyPort: siteResource.proxyPort,
        siteId: siteResource.siteId,
        destinationIp: siteResource.destinationIp,
        destinationPort: siteResource.destinationPort,
        siteNiceId: siteResource.siteNiceId
      };
    }
  );

  return (
    <>
      <SettingsSectionTitle
        title={t("resourceTitle")}
        description={t("resourceDescription")}
      />

      <OrgProvider org={org}>
        <ResourcesTable
          resources={resourceRows}
          internalResources={internalResourceRows}
          orgId={params.orgId}
          defaultView={
            env.flags.enableClients ? defaultView : "proxy"
          }
          defaultSort={{
            id: "name",
            desc: false
          }}
        />
      </OrgProvider>
    </>
  );
}