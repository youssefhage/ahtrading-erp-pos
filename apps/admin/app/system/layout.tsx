import { SystemTabs } from "@/components/system-tabs";

export default function SystemLayout(props: { children: React.ReactNode }) {
  return (
    <div className="pb-10">
      <SystemTabs className="mx-auto max-w-6xl px-4 pt-6" />
      {props.children}
    </div>
  );
}

