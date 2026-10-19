import { Navigate } from "@tanstack/react-router";

import { QuickstartEmbed } from "@/components/quickstart/quickstart-embed";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/spinner";
import { useProjectsList } from "@/hooks/use-projects";

export function NoProjectsEmptyState() {
  return <QuickstartEmbed />;
}

export function ProjectRequiredEmptyState({
  title = "Please select a project",
  description = "Select a project from the selector in the top bar to see this page.",
}: {
  title?: string;
  description?: string;
}) {
  const { data, isLoading } = useProjectsList();
  const projects = data?.projects ?? [];

  if (isLoading) {
    return <LoadingState fullPage label="Loading projects" />;
  }

  if (projects.length === 0) {
    return <Navigate replace search={{ projectId: undefined }} to="/" />;
  }

  return <EmptyState description={description} icon={Icon.folderAdd} title={title} />;
}
