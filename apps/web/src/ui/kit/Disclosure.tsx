import { type ReactNode } from "react";
import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Icon, type IconName } from "./Icon";

export interface AccordionSection {
  id: string;
  title: string;
  icon?: IconName;
  /** Rendered as a muted number after the title. `0` still shows, so an empty section is
   *  visibly empty rather than looking broken. */
  count?: number;
  /** Right-aligned in the header — a switch, a chip, an InfoTip. Clicks do not toggle. */
  action?: ReactNode;
  /** Marks the whole item, so a test or an audit can assert on the section rather than on its
   *  trigger. The trigger keeps the generated `${accordion}-${section}` id. */
  testId?: string;
  children: ReactNode;
}

/** Sections that open and close. `grid-template-rows: 0fr -> 1fr` gives a real height
 *  transition without measuring, which is why the panel does not jump on open. */
export function Accordion({
  sections,
  value,
  onValueChange,
  multiple = true,
  testId
}: {
  sections: readonly AccordionSection[];
  value?: string[];
  onValueChange?: (next: string[]) => void;
  multiple?: boolean;
  testId?: string;
}) {
  return (
    <BaseAccordion.Root
      className="kit-accordion"
      value={value}
      onValueChange={(next) => onValueChange?.(next as string[])}
      multiple={multiple}
      data-testid={testId}
    >
      {sections.map((section) => (
        <BaseAccordion.Item
          key={section.id}
          value={section.id}
          className="kit-accordion-item"
          data-testid={section.testId}
        >
          <BaseAccordion.Header className="kit-accordion-header">
            <BaseAccordion.Trigger
              className="kit-accordion-trigger"
              data-testid={testId ? `${testId}-${section.id}` : undefined}
            >
              {section.icon && <Icon name={section.icon} size={20} />}
              <span className="kit-accordion-title">{section.title}</span>
              {section.count != null && (
                <span className="kit-accordion-count">{section.count}</span>
              )}
              <Icon name="expand_more" size={20} className="kit-accordion-chevron" />
            </BaseAccordion.Trigger>
            {section.action && <span className="kit-accordion-action">{section.action}</span>}
          </BaseAccordion.Header>
          <BaseAccordion.Panel className="kit-accordion-panel">
            <div className="kit-accordion-content">{section.children}</div>
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}

export interface TabDefinition {
  id: string;
  label: string;
  icon?: IconName;
  count?: number;
  keepMounted?: boolean;
  children: ReactNode;
}

export function Tabs({
  tabs,
  value,
  onValueChange,
  testId
}: {
  tabs: readonly TabDefinition[];
  value: string;
  onValueChange: (next: string) => void;
  testId?: string;
}) {
  return (
    <BaseTabs.Root
      className="kit-tabs"
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      data-testid={testId}
    >
      <BaseTabs.List className="kit-tab-list">
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.id}
            value={tab.id}
            className="kit-tab"
            data-testid={testId ? `${testId}-${tab.id}` : undefined}
          >
            {tab.icon && <Icon name={tab.icon} size={18} filled={tab.id === value} />}
            {tab.label}
            {tab.count != null && <span className="kit-tab-count">{tab.count}</span>}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="kit-tab-indicator" />
      </BaseTabs.List>
      {tabs.map((tab) => (
        <BaseTabs.Panel
          key={tab.id}
          value={tab.id}
          keepMounted={tab.keepMounted}
          className="kit-tab-panel"
        >
          {tab.children}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
