# V1 attachments

Public surfaces: AttachmentsFeature.ThreadResourcesSheet, documentNavigation and attachmentVisibility. The feature owns list visibility, document stack/revision, preview source selection and link routing. Private sheet/view/preview helpers stay local.

The existing ThreadResourcesModel and private-transfer/cache owners retain canonical resources, authenticated access and async load cancellation. The ephemeral resource key includes the mounted preview owner and request revision; closing clears the stack. Attachment list cells retain their fixed row-height contract. The host supplies the existing code viewport bound rather than importing conversation protocol implementation.

ThreadChangeDiffValue moved to its existing lower thread-resource contract with all consumers. Shared HTTP(S) link validation moved from the request form to rendering/http-link; request and attachment consumers use the same implementation. No facade or root import is allowed. Review presentation uses the public review feature; the M4 review move is complete.

M4 attachment subunit: V1 gate passed (2168 modules, 7562 dependencies); 70 focused preview/private asset/resource/virtualization/source/boundary tests and one real scoped visibility render test passed. Native document/video/download and same-device performance scenarios remain explicitly unverified. All M4 subunits and M5–M8 source ownership are complete; final evidence is in the migration ledger.

`attachmentDocumentResource` owns the current document resource key, loader and result snapshot; `attachmentPreview` owns stack/revision and open/retry/link intents. Existing cancellation and mounted owner identity remain unchanged.
