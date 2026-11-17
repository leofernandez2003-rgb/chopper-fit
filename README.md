# Chopper Fit

Contador de calorías personal en formato PWA: calorías y macros, agua, ayuno intermitente, peso, entrenamientos, plan de comidas, retos con berries y tienda. Todo el registro es manual y los datos se guardan solo en el dispositivo.

## Instalar en iPhone

1. Abre la página del proyecto en **Safari**.
2. Toca **Compartir → Agregar a pantalla de inicio**.

## Desarrollo

No tiene paso de compilación. Para probarla en local:

```
python -m http.server 8765
```

Al publicar cambios, sube el número de `CACHE` en `sw.js`.

## Créditos

- Búsqueda en línea y códigos de barras: [Open Food Facts](https://world.openfoodfacts.org).
- Lector de códigos: [ZXing](https://github.com/zxing-js/library).
- Fotos de recetas y fondos generados localmente con Stable Diffusion.
- Animaciones de Chopper (`assets/chopper/`) generadas localmente con Wan 2.2 en [WanGP](https://github.com/deepbeepmeep/Wan2GP) a partir de `assets/chopper.png`.
- Proyecto personal de fan, sin fines comerciales. Tony Tony Chopper y One Piece pertenecen a Eiichiro Oda / Shueisha / Toei Animation.
