import { Button, InfoTip, Popover, Skeleton, TextArea } from "../kit";
import type { PlanDiscussionThread } from "./types";

/** §29.3: what the model was given is one popover per answer, not a grey paragraph repeated
 *  under every message. */
function Disclosure({ text, testId }: { text: string; testId?: string }) {
  return (
    <Popover
      title="Co AI vidělo"
      width={288}
      testId={testId}
      trigger={
        <Button variant="text" size="sm" icon="info">
          Co AI vidělo
        </Button>
      }
    >
      <p className="planner-hint">{text}</p>
    </Popover>
  );
}

/** The plan-scoped AI thread (§4.5).
 *
 *  User messages sit right in `--accent-soft`, answers left without a bubble; the consent line
 *  is one sentence behind an InfoTip rather than a paragraph of grey text. */
export function PlanAssistant({
  prompt,
  busy,
  threadLoading,
  thread,
  answer,
  persisted,
  onPromptChange,
  onSubmit,
  onNewThread
}: {
  prompt: string;
  busy: boolean;
  threadLoading: boolean;
  thread: PlanDiscussionThread | null;
  answer: { text: string; model: string; disclosure: string } | null;
  persisted: boolean;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onNewThread: () => void;
}) {
  return (
    <form
      id="planner-ai-discussion"
      className="planner-assistant"
      data-testid="plan-ai-discussion"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <header className="planner-assistant-head">
        <span className="kit-eyebrow">
          AI k plánu
          <InfoTip title="Co se posílá">
            Text dotazu a omezený přehled plánu: názvy a GPS zastávek, profil a souhrn úseků.
            Soukromé poznámky ani identita se neposílají a AI plán sama nezmění.
            {persisted
              ? " Vlákno je uložené jen u tvého plánu."
              : " Tento jednorázový dotaz se neuloží; po uložení plánu bude vlákno trvalé."}
          </InfoTip>
        </span>
        {thread && (
          <Button variant="text" size="sm" onClick={onNewThread}>
            Nové vlákno
          </Button>
        )}
      </header>

      {threadLoading && <Skeleton height={64} count={2} />}

      {thread && thread.messages.length > 0 && (
        <div className="planner-assistant-thread" data-testid="plan-ai-thread" aria-live="polite">
          {thread.messages.map((message) => (
            <article className={`role-${message.role}`} key={message.id}>
              <p>{message.content}</p>
              {message.role === "assistant" && message.disclosure && (
                <Disclosure text={message.disclosure} />
              )}
            </article>
          ))}
        </div>
      )}

      <TextArea
        label="Co chceš s plánem probrat?"
        rows={3}
        maxLength={2_000}
        value={prompt}
        placeholder="Např. Který den je příliš dlouhý a kde udělat pauzu?"
        onChange={(event) => onPromptChange(event.target.value)}
      />
      <Button
        type="submit"
        variant="tonal"
        icon="auto_awesome"
        block
        loading={busy}
        disabled={busy || threadLoading || !prompt.trim()}
      >
        Odeslat AI
      </Button>

      {answer && (
        <div className="planner-assistant-answer" role="status">
          <strong>AI doporučení</strong>
          <p>{answer.text}</p>
          <Disclosure text={answer.disclosure} testId="plan-ai-disclosure" />
        </div>
      )}
    </form>
  );
}
