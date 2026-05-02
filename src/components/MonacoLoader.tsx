import { useState } from 'react';
import Editor from '@monaco-editor/react';

const initialCode = `function hello(name: string) {
  return \`Hello, \${name}!\`;
}

console.log(hello('Monaco'));`;

export function MonacoLoader() {
  const [code, setCode] = useState(initialCode);

  function handleLoad() {
    console.log('Monaco editor content:', code);
  }

  return (
    <main className="monaco-loader">
      <button className="load-button" type="button" onClick={handleLoad}>
        Load
      </button>
      <section className="editor-pane" aria-label="Monaco editor">
        <Editor
          defaultLanguage="typescript"
          theme="vs-dark"
          value={code}
          onChange={(value) => setCode(value ?? '')}
          options={{
            automaticLayout: true,
            fontSize: 14,
            minimap: { enabled: false },
          }}
        />
      </section>
    </main>
  );
}
