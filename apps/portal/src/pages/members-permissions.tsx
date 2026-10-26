// Members & Permissions — members table with always-visible filters; the roles &
// permission matrix opens in a modal from the toolbar action.

import { PageHeader } from "../components/page-header";
import { useState } from "react";
import { Modal } from "../components/ui/modal";
import { useAuth } from "../lib/auth";
import { MembersTable } from "./roles-permissions/members-tab";
import { RolesTab } from "./roles-permissions/roles-tab";

export function MembersPermissionsPage(): React.JSX.Element {
  const { can } = useAuth();
  const [rolesOpen, setRolesOpen] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader crumbs={["Administration", "Members & Permissions"]} />

      {can("members.manage") ? (
        <MembersTable onManageRoles={() => setRolesOpen(true)} />
      ) : (
        <p className="text-[13px] text-text-muted">You need the members.manage permission.</p>
      )}

      <Modal
        open={rolesOpen}
        size="page"
        title="Roles & Permissions"
        description="Primary roles, admin-defined sub-roles and dynamic permission grants per role."
        onClose={() => setRolesOpen(false)}
      >
        {can("roles.manage") ? <RolesTab /> : <p className="text-[13px] text-text-muted">You need the roles.manage permission.</p>}
      </Modal>
    </div>
  );
}
