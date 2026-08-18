package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Spanned
import android.text.SpannableString
import android.text.SpannedString
import android.text.style.ForegroundColorSpan
import android.text.style.LineBackgroundSpan
import android.text.style.StyleSpan
import android.util.LruCache
import org.eclipse.tm4e.core.grammar.IGrammar
import org.eclipse.tm4e.core.grammar.IStateStack
import org.eclipse.tm4e.core.registry.IGrammarSource
import org.eclipse.tm4e.core.registry.Registry
import org.json.JSONArray
import java.security.MessageDigest
import java.time.Duration

internal object NativeCodeHighlighter {
  private const val CACHE_BYTES = 8 * 1024 * 1024
  private const val TOKENIZE_LINE_BUDGET_MS = 120L
  // Inline blocks have a 400dp viewport (about 25 lines). Tokenizing a generous
  // look-ahead keeps nearby scrolling highlighted without spending seconds on
  // off-screen tool output. The remaining source stays visible as plain native
  // text and can be copied in full.
  private const val MAX_TOKENIZED_LINES = 240

  private val cache = object : LruCache<String, NativeCodeHighlight>(CACHE_BYTES) {
    override fun sizeOf(key: String, value: NativeCodeHighlight): Int =
      value.code.length * 2 + (value.gutter?.length ?: 0) * 2 + 192
  }

  private val grammarLock = Any()
  private val registry = Registry()
  private val loadedGrammars = LinkedHashMap<String, IGrammar>()
  private var grammarAssetsByLanguage: Map<String, GrammarAsset>? = null

  fun highlight(context: Context, source: String, language: String, variant: String): NativeCodeHighlight {
    val cacheKey = "${language}\u0000${variant}\u0000${digest(source)}"
    synchronized(cache) {
      cache.get(cacheKey)?.let { return it }
    }
    val highlighted = buildHighlighted(context.applicationContext, source, language, variant)
    synchronized(cache) {
      cache.put(cacheKey, highlighted)
    }
    return highlighted
  }

  private fun buildHighlighted(context: Context, source: String, language: String, variant: String): NativeCodeHighlight {
    if (variant == "terminal") return NativeAnsiRenderer.render(source)
    val diff = if (variant == "diff") NativeDiffProjector.project(source) else null
    val renderedSource = diff?.code ?: source
    val text = SpannableString(renderedSource)
    if (text.isNotEmpty()) {
      text.setSpan(ForegroundColorSpan(Palette.TEXT), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    if (diff != null) applyDiffBackgrounds(text, diff)
    val grammar = grammarFor(context, language)
    if (grammar == null) return NativeCodeHighlight(SpannedString(text), diff?.let(::buildDiffGutter))
    var ruleStack: IStateStack? = null
    var oldDiffRuleStack: IStateStack? = null
    var newDiffRuleStack: IStateStack? = null
    var offset = 0
    var tokenizedLines = 0
    synchronized(grammar) {
      while (offset <= renderedSource.length && tokenizedLines < MAX_TOKENIZED_LINES) {
        if (Thread.currentThread().isInterrupted) throw InterruptedException("Native code highlighting superseded")
        val newline = renderedSource.indexOf('\n', offset)
        val lineEnd = if (newline < 0) renderedSource.length else newline
        val rawLine = renderedSource.substring(offset, lineEnd)
        val diffKind = diff?.lines?.getOrNull(tokenizedLines)?.kind
        val sourceDiff = diff != null && language != "diff"
        val line = rawLine
        val inputStack = when (diffKind) {
          NativeDiffLineKind.DELETION -> oldDiffRuleStack
          NativeDiffLineKind.ADDITION -> newDiffRuleStack
          NativeDiffLineKind.CONTEXT -> newDiffRuleStack
          else -> ruleStack
        }
        if (sourceDiff && diffKind == NativeDiffLineKind.META) {
          tokenizedLines += 1
          if (newline < 0) break
          offset = lineEnd + 1
          continue
        }
        val result = grammar.tokenizeLine(line, inputStack, Duration.ofMillis(TOKENIZE_LINE_BUDGET_MS))
        when (diffKind) {
          NativeDiffLineKind.DELETION -> oldDiffRuleStack = result.ruleStack
          NativeDiffLineKind.ADDITION -> newDiffRuleStack = result.ruleStack
          NativeDiffLineKind.CONTEXT -> {
            oldDiffRuleStack = result.ruleStack
            newDiffRuleStack = result.ruleStack
          }
          else -> ruleStack = result.ruleStack
        }
        for (token in result.tokens) {
          val contentOffset = offset
          val start = (contentOffset + token.startIndex).coerceIn(contentOffset, lineEnd)
          val end = (contentOffset + token.endIndex).coerceIn(start, lineEnd)
          if (start == end) continue
          val style = scopeStyle(token.scopes)
          text.setSpan(ForegroundColorSpan(style.color), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          if (style.typeface != Typeface.NORMAL) {
            text.setSpan(StyleSpan(style.typeface), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          }
        }
        tokenizedLines += 1
        if (newline < 0) break
        offset = lineEnd + 1
      }
    }
    return NativeCodeHighlight(SpannedString(text), diff?.let(::buildDiffGutter))
  }

  private fun grammarFor(context: Context, language: String): IGrammar? = synchronized(grammarLock) {
    loadedGrammars[language]?.let { return@synchronized it }
    val assets = grammarAssets(context)
    for (dependency in assets[language]?.dependencies.orEmpty()) {
      loadGrammar(context, dependency, assets)
    }
    loadGrammar(context, language, assets)
  }

  private fun loadGrammar(context: Context, language: String, assets: Map<String, GrammarAsset>): IGrammar? {
    loadedGrammars[language]?.let { return it }
    val asset = assets[language] ?: return null
    return try {
      context.assets.open("native-code/grammars/${asset.fileName}").use { stream ->
        registry.addGrammar(IGrammarSource.fromInputStream(stream, asset.fileName, Charsets.UTF_8))
          .takeIf { it.scopeName == asset.scopeName }
          ?.also { loadedGrammars[language] = it }
      }
    } catch (_: Exception) {
      // A missing or unsupported grammar degrades to plain native text. One bad
      // language must never blank or crash the whole timeline.
      null
    }
  }

  private fun grammarAssets(context: Context): Map<String, GrammarAsset> {
    grammarAssetsByLanguage?.let { return it }
    val loaded = try {
      context.assets.open("native-code/native-code-languages.json").bufferedReader(Charsets.UTF_8).use { reader ->
        val entries = JSONArray(reader.readText())
        buildMap {
          for (index in 0 until entries.length()) {
            val entry = entries.getJSONObject(index)
            val fileName = entry.getString("fileName")
            if (fileName.isBlank()) continue
            val dependenciesJson = entry.getJSONArray("dependencies")
            val dependencies = buildList {
              for (dependencyIndex in 0 until dependenciesJson.length()) add(dependenciesJson.getString(dependencyIndex))
            }
            put(entry.getString("id"), GrammarAsset(entry.getString("scopeName"), fileName, dependencies))
          }
        }
      }
    } catch (_: Exception) {
      emptyMap()
    }
    grammarAssetsByLanguage = loaded
    return loaded
  }

  private fun applyDiffBackgrounds(text: SpannableString, projection: NativeDiffProjection) {
    for (line in projection.lines) {
      val background = diffBackground(line.kind) ?: continue
      if (line.end > line.start) {
        text.setSpan(FullLineBackgroundSpan(background), line.start, line.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }
  }

  private fun buildDiffGutter(projection: NativeDiffProjection): SpannedString {
    val gutter = SpannableString(projection.gutter)
    var offset = 0
    for (line in projection.lines) {
      val newline = projection.gutter.indexOf('\n', offset)
      val end = if (newline < 0) projection.gutter.length else newline + 1
      if (end > offset) {
        val foreground = when (line.kind) {
          NativeDiffLineKind.ADDITION -> Palette.DIFF_ADD
          NativeDiffLineKind.DELETION -> Palette.DIFF_DELETE
          NativeDiffLineKind.META -> Palette.DIFF_META
          NativeDiffLineKind.CONTEXT -> Palette.GUTTER
        }
        gutter.setSpan(ForegroundColorSpan(foreground), offset, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        diffBackground(line.kind)?.let { background ->
          gutter.setSpan(FullLineBackgroundSpan(background), offset, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
      }
      if (newline < 0) break
      offset = newline + 1
    }
    return SpannedString(gutter)
  }

  private fun diffBackground(kind: NativeDiffLineKind): Int? = when (kind) {
    NativeDiffLineKind.ADDITION -> Palette.DIFF_ADD_BG
    NativeDiffLineKind.DELETION -> Palette.DIFF_DELETE_BG
    NativeDiffLineKind.META -> Palette.DIFF_META_BG
    NativeDiffLineKind.CONTEXT -> null
  }

  private fun scopeStyle(scopes: List<String>): TokenStyle {
    val scope = scopes.joinToString(" ").lowercase()
    return when {
      "invalid" in scope -> TokenStyle(Palette.INVALID)
      "comment" in scope -> TokenStyle(Palette.COMMENT, Typeface.ITALIC)
      "string" in scope || "quoted" in scope -> TokenStyle(Palette.STRING)
      "constant.numeric" in scope || "constant.language" in scope || "boolean" in scope -> TokenStyle(Palette.CONSTANT)
      "keyword" in scope || "storage" in scope || "control" in scope -> TokenStyle(Palette.KEYWORD)
      "entity.name.function" in scope || "support.function" in scope -> TokenStyle(Palette.FUNCTION)
      "entity.name.type" in scope || "entity.name.class" in scope || "support.type" in scope -> TokenStyle(Palette.TYPE)
      "variable.parameter" in scope -> TokenStyle(Palette.PARAMETER)
      "markup.heading" in scope || "markup.bold" in scope -> TokenStyle(Palette.HEADING, Typeface.BOLD)
      "markup.inserted" in scope -> TokenStyle(Palette.DIFF_ADD)
      "markup.deleted" in scope -> TokenStyle(Palette.DIFF_DELETE)
      "meta.diff.range" in scope || "markup.changed" in scope -> TokenStyle(Palette.DIFF_META)
      "punctuation" in scope -> TokenStyle(Palette.PUNCTUATION)
      else -> TokenStyle(Palette.TEXT)
    }
  }

  private fun digest(source: String): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8))
    return bytes.take(12).joinToString("") { "%02x".format(it) }
  }

  private data class GrammarAsset(val scopeName: String, val fileName: String, val dependencies: List<String>)
  private data class TokenStyle(val color: Int, val typeface: Int = Typeface.NORMAL)

  private object Palette {
    val TEXT = Color.rgb(211, 215, 222)
    val COMMENT = Color.rgb(124, 133, 145)
    val STRING = Color.rgb(166, 218, 149)
    val CONSTANT = Color.rgb(238, 190, 131)
    val KEYWORD = Color.rgb(202, 158, 230)
    val FUNCTION = Color.rgb(139, 184, 246)
    val TYPE = Color.rgb(238, 212, 159)
    val PARAMETER = Color.rgb(235, 160, 172)
    val HEADING = Color.rgb(201, 209, 217)
    val PUNCTUATION = Color.rgb(171, 178, 191)
    val GUTTER = Color.rgb(105, 112, 122)
    val INVALID = Color.rgb(255, 123, 114)
    val DIFF_ADD = Color.rgb(141, 229, 166)
    val DIFF_DELETE = Color.rgb(255, 156, 163)
    val DIFF_META = Color.rgb(208, 208, 208)
    val DIFF_ADD_BG = Color.rgb(16, 41, 26)
    val DIFF_DELETE_BG = Color.rgb(50, 23, 27)
    val DIFF_META_BG = Color.rgb(36, 36, 36)
  }
}

internal data class NativeCodeHighlight(
  val code: SpannedString,
  val gutter: SpannedString?,
)

/** BackgroundColorSpan only paints behind glyphs, producing ragged diff rows.
 * A paragraph span receives the full TextView line bounds instead. */
private class FullLineBackgroundSpan(private val color: Int) : LineBackgroundSpan {
  override fun drawBackground(
    canvas: Canvas,
    paint: Paint,
    left: Int,
    right: Int,
    top: Int,
    baseline: Int,
    bottom: Int,
    text: CharSequence,
    start: Int,
    end: Int,
    lineNumber: Int,
  ) {
    val previousColor = paint.color
    canvas.drawRect(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat(), paint.apply { color = this@FullLineBackgroundSpan.color })
    paint.color = previousColor
  }
}
