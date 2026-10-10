import { Navigate, NavLink, useParams } from "react-router-dom";
import { Breadcrumbs } from "../components/breadcrumbs";
import { AreaCard, type AreaCardProps } from "../components/area-card";
import { DELIVERY_AREAS } from "../lib/delivery-areas";

export function DeliveryPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Delivery"]} />
      <section className="flex flex-col gap-2">
        <h1 className="text-[20px] font-semibold tracking-tight text-text">Delivery workstreams</h1>
        <p className="text-[14px] text-text-secondary">Choose a workstream from the navigation to view its scope and status.</p>
        <nav aria-label="Delivery workstreams" className="mt-3 grid grid-cols-1 gap-2 md:hidden">
          {DELIVERY_AREAS.map((area) => (
            <NavLink
              key={area.id}
              to={`/delivery/${area.id}`}
              className="flex min-h-11 items-center rounded-[10px] px-3 text-[14px] text-text-secondary shadow-border hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
            >
              {area.title}
            </NavLink>
          ))}
        </nav>
      </section>
    </div>
  );
}

export function DeliveryAreaPage(): React.JSX.Element {
  const { areaId } = useParams();
  const area = DELIVERY_AREAS.find((candidate) => candidate.id === areaId);
  if (area === undefined) return <Navigate to="/delivery" replace />;

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Delivery", area.title]} />
      <section className="max-w-3xl">
        <AreaCard {...(area satisfies AreaCardProps)} />
      </section>
    </div>
  );
}
