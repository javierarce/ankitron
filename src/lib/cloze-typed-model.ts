import { ankiFetch } from "./anki-fetch";

export const CLOZE_TYPED_MODEL = "Cloze (typed)";

const DEFAULT_CLOZE_CSS = `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
}

.cloze {
  font-weight: bold;
  color: blue;
}
.nightMode .cloze {
  color: lightblue;
}
`;

const CARD_TEMPLATE_NAME = "Cloze";
const FRONT_TEMPLATE = `{{cloze:Text}}<br>{{type:cloze:Text}}`;
const BACK_TEMPLATE = `{{cloze:Text}}<br>{{type:cloze:Text}}<hr id=answer>{{Back Extra}}`;

let ensured = false;

export async function ensureClozeTypedModel(): Promise<void> {
  if (ensured) return;
  const names = await ankiFetch<string[]>("modelNames");
  if (names.includes(CLOZE_TYPED_MODEL)) {
    await ankiFetch("updateModelTemplates", {
      model: {
        name: CLOZE_TYPED_MODEL,
        templates: {
          [CARD_TEMPLATE_NAME]: { Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE },
        },
      },
    });
    ensured = true;
    return;
  }
  await ankiFetch("createModel", {
    modelName: CLOZE_TYPED_MODEL,
    inOrderFields: ["Text", "Back Extra"],
    isCloze: true,
    css: DEFAULT_CLOZE_CSS,
    cardTemplates: [
      {
        Name: CARD_TEMPLATE_NAME,
        Front: FRONT_TEMPLATE,
        Back: BACK_TEMPLATE,
      },
    ],
  });
  ensured = true;
}
