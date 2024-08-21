import {
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import {
  findCommentsInCut,
  findDetachedCommentsInChanges,
  restoreCommentsOnPaste,
  restoreDetachedComments,
  StoredComment,
} from './changes/comments'
import { invertedEffects } from '@codemirror/commands'
import { Change, DeleteOperation } from '../../../../../types/change'
import { ChangeManager } from './changes/change-manager'
import { debugConsole } from '@/utils/debugging'
import { isCommentOperation, isDeleteOperation } from '@/utils/operations'
import {
  DocumentContainer,
  RangesTrackerWithResolvedThreadIds,
} from '@/features/ide-react/editor/document-container'
import { Ranges } from '@/features/review-panel-new/context/ranges-context'
import { Threads } from '@/features/review-panel-new/context/threads-context'
import { isSplitTestEnabled } from '@/utils/splitTestUtils'

type RangesData = {
  ranges: Ranges
  threads: Threads
}

const clearChangesEffect = StateEffect.define()
const buildChangesEffect = StateEffect.define()
const restoreDetachedCommentsEffect = StateEffect.define<RangeSet<any>>({
  map: (value, mapping) => {
    return value
      .update({
        filter: (from, to) => {
          return from <= mapping.length && to <= mapping.length
        },
      })
      .map(mapping)
  },
})

type Options = {
  currentDoc: DocumentContainer
  loadingThreads?: boolean
  ranges?: Ranges
  threads?: Threads
}

/**
 * A custom extension that initialises the change manager, passes any updates to it,
 * and produces decorations for tracked changes and comments.
 */
export const trackChanges = (
  { currentDoc, loadingThreads, ranges, threads }: Options,
  changeManager?: ChangeManager
) => {
  // A state field that stored any comments found within the ranges of a "cut" transaction,
  // to be restored when pasting matching text.
  const cutCommentsState = StateField.define<StoredComment[]>({
    create: () => {
      return []
    },
    update: (value, transaction) => {
      if (transaction.annotation(Transaction.remote)) {
        return value
      }

      if (!transaction.docChanged) {
        return value
      }

      if (transaction.isUserEvent('delete.cut')) {
        return findCommentsInCut(currentDoc, transaction)
      }

      if (transaction.isUserEvent('input.paste')) {
        restoreCommentsOnPaste(currentDoc, transaction, value)
        return []
      }

      return value
    },
  })

  return [
    // attach any comments detached by the transaction as an inverted effect, to be applied on undo
    invertedEffects.of(transaction => {
      if (
        transaction.docChanged &&
        !transaction.annotation(Transaction.remote)
      ) {
        const detachedComments = findDetachedCommentsInChanges(
          currentDoc,
          transaction
        )
        if (detachedComments.size) {
          return [restoreDetachedCommentsEffect.of(detachedComments)]
        }
      }
      return []
    }),

    // restore any detached comments on undo
    EditorState.transactionExtender.of(transaction => {
      for (const effect of transaction.effects) {
        if (effect.is(restoreDetachedCommentsEffect)) {
          // send the comments to the ShareJS doc
          restoreDetachedComments(currentDoc, transaction, effect.value)

          // return a transaction spec to rebuild the change markers
          return buildChangeMarkers()
        }
      }
      return null
    }),

    cutCommentsState,

    // initialize/destroy the change manager, and handle any updates
    changeManager
      ? ViewPlugin.define(() => {
          changeManager.initialize()

          return {
            update: update => {
              changeManager.handleUpdate(update)
            },
            destroy: () => {
              changeManager.destroy()
            },
          }
        })
      : ViewPlugin.define(view => {
          let timer: number

          return {
            update(update) {
              if (update.viewportChanged) {
                if (timer) {
                  window.clearTimeout(timer)
                }

                timer = window.setTimeout(() => {
                  dispatchEvent(new Event('editor:viewport-changed'))
                }, 25)
              }
            },
          }
        }),

    // draw change decorations
    ViewPlugin.define<
      PluginValue & {
        decorations: DecorationSet
      }
    >(
      () => {
        let decorations = Decoration.none
        if (isSplitTestEnabled('review-panel-redesign')) {
          if (ranges && threads) {
            decorations = buildChangeDecorations(currentDoc, {
              ranges,
              threads,
            })
          }
        } else if (!loadingThreads) {
          decorations = buildChangeDecorations(currentDoc)
        }

        return {
          decorations,
          update(update) {
            for (const transaction of update.transactions) {
              this.decorations = this.decorations.map(transaction.changes)

              for (const effect of transaction.effects) {
                if (effect.is(clearChangesEffect)) {
                  this.decorations = Decoration.none
                } else if (effect.is(buildChangesEffect)) {
                  this.decorations = buildChangeDecorations(currentDoc)
                }
              }
            }
          },
        }
      },
      {
        decorations: value => value.decorations,
      }
    ),

    // styles for change decorations
    trackChangesTheme,
  ]
}

export const clearChangeMarkers = () => {
  return {
    effects: clearChangesEffect.of(null),
  }
}

export const buildChangeMarkers = () => {
  return {
    effects: buildChangesEffect.of(null),
  }
}

const buildChangeDecorations = (
  currentDoc: DocumentContainer,
  data?: RangesData
) => {
  const ranges = data ? data.ranges : currentDoc.ranges

  if (!ranges) {
    return Decoration.none
  }

  const changes = [...ranges.changes, ...ranges.comments]

  const decorations = []

  for (const change of changes) {
    try {
      decorations.push(...createChangeRange(change, currentDoc, data))
    } catch (error) {
      // ignore invalid changes
      debugConsole.debug('invalid change position', error)
    }
  }

  return Decoration.set(decorations, true)
}

class ChangeDeletedWidget extends WidgetType {
  constructor(public change: Change<DeleteOperation>) {
    super()
  }

  toDOM() {
    const widget = document.createElement('span')
    widget.classList.add('ol-cm-change')
    widget.classList.add('ol-cm-change-d')

    return widget
  }

  eq() {
    return true
  }
}

class ChangeCalloutWidget extends WidgetType {
  constructor(
    public change: Change,
    public opType: string
  ) {
    super()
  }

  toDOM() {
    const widget = document.createElement('span')
    widget.className = 'ol-cm-change-callout'
    widget.classList.add(`ol-cm-change-callout-${this.opType}`)

    const inner = document.createElement('span')
    inner.classList.add('ol-cm-change-callout-inner')
    widget.appendChild(inner)

    return widget
  }

  eq(widget: ChangeCalloutWidget) {
    return widget.opType === this.opType
  }

  updateDOM(element: HTMLElement) {
    element.className = 'ol-cm-change-callout'
    element.classList.add(`ol-cm-change-callout-${this.opType}`)
    return true
  }
}

const createChangeRange = (
  change: Change,
  currentDoc: DocumentContainer,
  data?: RangesData
) => {
  const { id, metadata, op } = change

  const from = op.p
  // TODO: find valid positions?

  if (isDeleteOperation(op)) {
    const opType = 'd'

    const changeWidget = Decoration.widget({
      widget: new ChangeDeletedWidget(change as Change<DeleteOperation>),
      side: 1,
      opType,
      id,
      metadata,
    })

    const calloutWidget = Decoration.widget({
      widget: new ChangeCalloutWidget(change, opType),
      side: 1,
      opType,
      id,
      metadata,
    })

    return [calloutWidget.range(from, from), changeWidget.range(from, from)]
  }

  const _isCommentOperation = isCommentOperation(op)

  if (
    _isCommentOperation &&
    (currentDoc.ranges as RangesTrackerWithResolvedThreadIds)
      .resolvedThreadIds![op.t]
  ) {
    return []
  }

  if (_isCommentOperation) {
    if (data) {
      const thread = data.threads[op.t]
      if (!thread || thread.resolved) {
        return []
      }
    } else if (
      (currentDoc.ranges as RangesTrackerWithResolvedThreadIds)
        .resolvedThreadIds![op.t]
    ) {
      return []
    }
  }

  const opType = _isCommentOperation ? 'c' : 'i'
  const changedText = _isCommentOperation ? op.c : op.i
  const to = from + changedText.length

  // Mark decorations must not be empty
  if (from === to) {
    return []
  }

  const changeMark = Decoration.mark({
    tagName: 'span',
    class: `ol-cm-change ol-cm-change-${opType}`,
    opType,
    id,
    metadata,
  })

  const calloutWidget = Decoration.widget({
    widget: new ChangeCalloutWidget(change, opType),
    opType,
    id,
    metadata,
  })

  return [calloutWidget.range(from, from), changeMark.range(from, to)]
}

const trackChangesTheme = EditorView.baseTheme({
  '.cm-line': {
    overflowX: 'hidden', // needed so the callout elements don't overflow (requires line wrapping to be on)
  },
  '&light .ol-cm-change-i': {
    backgroundColor: '#2c8e304d',
  },
  '&dark .ol-cm-change-i': {
    backgroundColor: 'rgba(37, 107, 41, 0.15)',
  },
  '&light .ol-cm-change-c': {
    backgroundColor: '#f3b1114d',
  },
  '&dark .ol-cm-change-c': {
    backgroundColor: 'rgba(194, 93, 11, 0.15)',
  },
  '.ol-cm-change': {
    padding: 'var(--half-leading, 0) 0',
  },
  '.ol-cm-change-d': {
    borderLeft: '2px dotted #c5060b',
    marginLeft: '-1px',
  },
  '.ol-cm-change-callout': {
    position: 'relative',
    pointerEvents: 'none',
    padding: 'var(--half-leading, 0) 0',
  },
  '.ol-cm-change-callout-inner': {
    display: 'inline-block',
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '100vw',
    borderBottom: '1px dashed black',
  },
  // disable callout line in Firefox
  '@supports (-moz-appearance:none)': {
    '.ol-cm-change-callout-inner': {
      display: 'none',
    },
  },
  '.ol-cm-change-callout-i .ol-cm-change-callout-inner': {
    borderColor: '#2c8e30',
  },
  '.ol-cm-change-callout-c .ol-cm-change-callout-inner': {
    borderColor: '#f3b111',
  },
  '.ol-cm-change-callout-d .ol-cm-change-callout-inner': {
    borderColor: '#c5060b',
  },
})
