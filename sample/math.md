# KaTeX 数式

`$ ... $` でインライン、`$$ ... $$` でブロック数式を書けます。

## インライン数式

オイラーの等式 $e^{i\pi} + 1 = 0$ は、指数関数 $e^x$ と三角関数 $\sin x, \cos x$ を結びつけます。
二次方程式 $ax^2 + bx + c = 0$ の解は $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ です。

## ブロック数式

ガウス積分:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

フーリエ変換:

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi} \, dx
$$

## 行列

$$
\begin{pmatrix}
\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix}
x\cos\theta - y\sin\theta \\
x\sin\theta + y\cos\theta
\end{pmatrix}
$$

## 場合分け

$$
f(n) =
\begin{cases}
n/2 & \text{if } n \equiv 0 \pmod 2 \\
3n + 1 & \text{if } n \equiv 1 \pmod 2
\end{cases}
$$

長い数式は横スクロールできます:

$$
\sum_{k=0}^{n} \binom{n}{k} x^k y^{n-k} = (x+y)^n \quad\quad \prod_{p \text{ prime}} \frac{1}{1-p^{-s}} = \sum_{n=1}^{\infty} \frac{1}{n^s} = \zeta(s) \quad\quad \lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n = e
$$
