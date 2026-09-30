import { useSignal } from '@preact/signals';
import { useApp } from '../context';

/** "Or type a question…": Enter sends, starting a session if needed. */
export function TextBox() {
  const app = useApp();
  const text = useSignal('');
  return (
    <form
      class="iris-textbox"
      onSubmit={(event) => {
        event.preventDefault();
        const question = text.value.trim();
        if (!question) return;
        app.sendText(question);
        text.value = '';
      }}
    >
      <label class="iris-visually-hidden" for="iris-question">
        Type a question
      </label>
      <input
        id="iris-question"
        class="iris-textbox__input"
        type="text"
        autocomplete="off"
        placeholder="Or type a question…"
        value={text.value}
        onInput={(event) => (text.value = event.currentTarget.value)}
      />
    </form>
  );
}
