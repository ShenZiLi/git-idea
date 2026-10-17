# 侧边栏图标

## 视觉与交互

- 参考 IDEA New UI 工具窗口的简洁轮廓、统一线宽与紧凑排布。
- 左右侧栏共用一套生成素材，图标通过亮度遮罩继承当前主题颜色；选中工具使用蓝色和侧边标记。
- 保留按钮的名称、悬停提示、键盘焦点、禁用状态与按压反馈。储藏页现在也显示选中状态。
- 图标随 Windows 桌面窗口的全局百分比缩放，不单独改变编辑器字号。

## 素材

- 文件：`src/assets/idea-sidebar-atlas.png`。
- 生成方式：内置 imagegen 图片工具；工具没有模型版本参数，未指定或确认 image2.5。
- 内容：4 列 × 3 行，顺序为项目、提交、分支、日志、控制台、帮助、更改、通知、储藏、太阳、月亮、设置。
- 使用方式：`src/components/SidebarIcon.tsx` 直接读取最终生成图片，不在代码中裁切或重绘图片，通过 CSS 亮度遮罩显示各个图标。
- 黑色是遮罩的透明区域，白色是可见轮廓；界面中不会出现黑色底图。

## 生成提示词

```text
Create ONE clean production monochrome icon sprite atlas for an IDE sidebar. This is a flat digital asset, NOT an illustration or a presentation.
Opaque background must be completely uniform pure black #000000, edge to edge. Glyph strokes must be pure white #FFFFFF. All glyph interiors are black. Use absolutely no transparency, no gray fill, no noise, no sketch lines, no texture, no surrounding white regions.
Canvas landscape aspect ratio 4:3. Divide canvas invisibly into EXACTLY 4 equal columns and 3 equal rows. Do not draw the grid. Center each glyph at each exact cell center. Glyph bounding box is 70% of the cell. Identical size and consistent line thickness throughout.
The icon style is IntelliJ IDEA New UI tool-window icons: simple, understated, precise thin outline geometry with subtly squared corners, utilitarian and legible at 20px. Use a single continuous white stroke on black, approximately 1.6px when each cell is reduced to 24px. Avoid double contours. Shapes must look hollow, not solid white silhouettes. Tiny branch-node circles are also hollow.
Exactly twelve icons, left to right, top to bottom:
1. Top left: outline folder with a folder tab.
2. Top second: a thin simple checkmark (commit).
3. Top third: a Git branch, vertical trunk, right fork, three hollow round nodes.
4. Top right: Git log graph, two vertical tracks, three hollow round nodes, one joining branch.
5. Middle left: rectangular terminal window outline with a white greater-than symbol and short underscore.
6. Middle second: thin circle with a white question mark.
7. Middle third: a small checkmark to the left of two short horizontal white lines (changes).
8. Middle right: outline bell and tiny clapper.
9. Bottom left: outline archive box with lid and a short slot.
10. Bottom second: thin small sun circle and eight thin rays.
11. Bottom third: hollow outline crescent moon with black interior.
12. Bottom right: thin outline settings cog with eight simple teeth and a hollow circular center.
No text, numbers, labels, logos, gradients, shadow, blur, chalk, grain, decoration, panels, tile backgrounds, or extra pixels. Clean CAD-like digital outlines. Black is pure black everywhere outside the narrow white strokes.
```

## 最终加粗提示词

以生成的图标图为编辑目标，使用同一内置图片工具调整线宽，保留布局和图形。

```text
Edit target: the supplied black-and-white IDE sidebar icon sprite atlas.
Make ONE precise change: increase every white outline and glyph stroke to THREE TIMES its current thickness. The current lines are too thin for a 16px icon. We need medium-bold utilitarian IDEA-style UI icons. At this large canvas size every white stroke must be approximately 24 pixels thick (about 7 percent of the width of an individual cell), NOT 8 pixels. This gives about 1.5px optical stroke at actual small UI sizes.
Preserve the 4-column by 3-row layout, exact canvas aspect ratio, exact icon centers, exact cell order and all 12 existing symbol shapes. Preserve the solid opaque pure black background and pure white strokes. Closed shapes must remain hollow with pure black interiors. Preserve all padding. Crisp geometric digital edges, no texture, no gray noise, no gradients, no shadow, no new text or objects.
The branch and log node circles must remain visibly hollow after thickening. Do not turn outlines into solid blobs. Only increase stroke weight uniformly for clarity at small size.
```
