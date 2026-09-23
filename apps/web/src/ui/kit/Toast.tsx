import { type ReactNode } from "react";
import { Toast as BaseToast } from "@base-ui/react/toast";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./Button";
import { t } from "../../i18n";

/** Toasts live outside React state so non-component code — a failed layer fetch, a finished
 *  import job — can raise one without a hook. */
export const toastManager = BaseToast.createToastManager();

export type ToastTone = "info" | "success" | "warning" | "danger";

export function notify(
  title: string,
  options: {
    description?: string;
    tone?: ToastTone;
    /** Milliseconds. Errors default to staying until dismissed, because a message you did
     *  not have time to read is the same as no message. */
    timeout?: number;
    action?: { label: string; onClick: () => void };
  } = {}
) {
  const tone = options.tone ?? "info";
  toastManager.add({
    title,
    description: options.description,
    type: tone,
    timeout: options.timeout ?? (tone === "danger" ? 0 : 5000),
    actionProps: options.action
      ? { children: options.action.label, onClick: options.action.onClick }
      : undefined
  });
}

const TONE_ICONS: Record<ToastTone, IconName> = {
  info: "info",
  success: "check_circle",
  warning: "warning",
  danger: "error"
};

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider toastManager={toastManager} limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="kit-toast-viewport">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();

  return (
    <>
      {toasts.map((toast) => {
        const tone = (toast.type as ToastTone | undefined) ?? "info";
        return (
          <BaseToast.Root key={toast.id} toast={toast} className="kit-toast" data-tone={tone}>
            <Icon name={TONE_ICONS[tone]} size={20} className="kit-toast-icon" />
            <div className="kit-toast-text">
              <BaseToast.Title className="kit-toast-title" />
              <BaseToast.Description className="kit-toast-description" />
            </div>
            {toast.actionProps && <BaseToast.Action className="kit-toast-action" />}
            <BaseToast.Close
              render={<IconButton icon="close" label={t("panel.close")} size="sm" round />}
            />
          </BaseToast.Root>
        );
      })}
    </>
  );
}
