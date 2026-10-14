---
name: styleshift-page-sources
description: Page 03 (Style Shift) is built from the "342450 Give Photo" app project; where its CSS, copy, photos and the Runway outpaint recipe come from
metadata:
  type: reference
---

Page 03 (`pages/03-styleshift/`) is a static case study of the real Style Shift app at
`E:\Claude_Code\Projects\342450 Give Photo` (React frontend + FastAPI backend). Built
2026-10-12/13 to match a Figma frame and a Design-canvas artboard the user supplied.

**Where things come from:**
- UI strings, colours and type sizes: `frontend/src/styles.css` and `frontend/src/App.tsx`
  in that project (blue `#1a4cf5`, cream `#f5f1e9`, Inter from Google Fonts, 13px radii,
  1.5px borders). The page's `style.css` is a port of them.
- The library gallery is the app's `AccordionGallery.tsx` with the app's props
  (expandRatio 0.29, gap 2, radius 4, no labels).
- Workflow card copy was transcribed from `style_shift_workflow.png` at that project's root;
  it exists nowhere as text. The intro / Looks / Audit paragraphs exist only in the Figma
  frame, not in the project.
- Photos: `library/*.png` renders (2752x1536) in that project, converted to 1376px JPEGs in
  `pages/03-styleshift/assets/` by the scratch script in the session; the man-on-the-steps
  set is the Looks grid, `0001fff100a6.png` is the yellow-jacket library hero.
- Layout proportions come from a Figma spec JSON the user pasted (4036px-wide design,
  scaled by `--u = pageWidth/4036`) and from the Design artboard
  https://claude.ai/artifact/1zFX5tACYKGf4r374K1KcQ (audit card + how-it-works board,
  1290- and 1296-px frames, scaled by `--a` / `--b`).

**Runway outpaint recipe (works from PowerShell, no Python needed):**
`pages/03-styleshift/assets/runway-outpaint.ps1` calls the Runway dev API
(`POST https://api.dev.runwayml.com/v1/text_to_image`, header `X-Runway-Version:
2024-11-06`, key from that project's `.env` `RUNWAYML_API_SECRET`) with the app's model
`gemini_image3_pro`, ratio `2752:1536`, the photo inline as the `@photo` reference, and the
pipeline's 16:9 extension prompt. It spends the user's Runway credits (~25 s per image).

**Gotchas:**
- Windows PowerShell 5.1 `Invoke-RestMethod` sends string bodies as Latin-1; a prompt with
  em dashes makes the API answer "Invalid JSON". Send `[Text.Encoding]::UTF8.GetBytes($body)`.
- The model tends to re-render rather than extend: the first attempt shrank the subject and
  added a ceiling. Pinning the scale in the prompt ("kept pixel-for-pixel at its original
  scale, filling the full height, only new width at the sides, do not zoom out") fixed it.
- `python` on this machine is only the Store stub, so the app's own `scripts/runway.py`
  cannot be run here; call the REST API directly instead.
