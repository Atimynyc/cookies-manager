| [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **Español ✓** | [Português (Brasil)](README.pt-BR.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Română](README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

Gestiona las cookies, Local Storage y Session Storage, del sitio web que elijas, desde una ventana emergente o desde el panel lateral Chrome. Diseñado para desarrolladores, probadores y usuarios avanzados que deseen inspeccionar y modificar los datos del sitio sin necesidad de abrir DevTools.

## Empezar

1. Instala [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda) desde la tienda web Chrome.
2. Abre una página HTTP/HTTPS y haz clic en el icono de la extensión.
3. Acepta el acceso al sitio web seleccionado cuando se te solicite y, a continuación, selecciona «Cookies», «Local Storage» o «Session Storage».
4. Busca, edita, importa o exporta datos. Abre el panel lateral para disponer de un espacio de trabajo más amplio, o activa la recarga automática de la página tras realizar cambios.

Para la instalación local, clona este repositorio, abre `chrome://extensions`, activa el modo de desarrollador y utiliza la opción «Cargar sin empaquetar» para seleccionar la carpeta del repositorio que contiene `manifest.json`. La extensión se ejecuta directamente desde los archivos incluidos; no es necesario realizar ningún paso de compilación.

## Características

- Busca cookies por nombre, valor, dominio o ruta.
- El editor conserva los atributos de dominio, ruta, SameSite, Secure y HttpOnly de cada cookie cuando se modifica su valor o su fecha de caducidad.
- Crear y eliminar cookies, eliminar elementos seleccionados y establecer valores por lotes.
- Ver, crear, modificar y eliminar las entradas Local Storage y Session Storage.
- Las entradas favoritas de cookies HTTP y almacenamiento web aparecen en la parte superior de cada lista de datos.
- Previsualiza las exportaciones y guarda la vista actual, los elementos seleccionados o todos los datos del sitio como un paquete JSON con control de versiones, en un archivo o en el portapapeles. Importa con una vista previa de diferencias, selección por elementos, estrategias de resolución de conflictos, progreso, resultados y deshacer por lotes.
- Importar y exportar cookies en el formato «cookie-jar» Netscape/cURL, incluyendo la convención `#HttpOnly_` y las cookies de sesión.
- Guarda localmente los estados reutilizables del sitio con etiquetas, reglas de origen, estrategias predeterminadas para resolver conflictos y variables introducidas al aplicar un estado. Cambia el nombre, duplica, exporta, aplica o elimina los estados guardados.
- Importa rápidamente las cookies utilizando los campos independientes Name y Value, o añade una entrada de almacenamiento con `key=value`. Copia valores, pares `name=value` o JSON estructurados.
- Utiliza las herramientas de codificación y descodificación de URL, de formateo y compactación JSON, y de descodificación de la carga útil JWT al editar los valores.
- Consulta los cambios recientes y las diferencias entre el antes y el después, vuelve a intentar las operaciones fallidas y deshaz los cambios que sea posible durante la sesión actual del navegador.
- Cambia el destino entre las pestañas HTTP y HTTPS en la ventana actual del navegador.

El formato Netscape/cURL solo admite cookies. No conserva el atributo SameSite, la información de partición Partitioned/CHIPS ni el identificador del almacén de cookies Chrome. Utiliza los paquetes JSON para conservar estos atributos y el almacenamiento web.

## Idiomas y temas

La interfaz está disponible en inglés, chino simplificado, chino tradicional, español, portugués de Brasil, alemán, francés, japonés y rumano. Todas las traducciones se incluyen con la extensión y funcionan sin conexión.

La primera vez que se utiliza, se selecciona un idioma compatible de entre los disponibles en Chrome y se guarda; los idiomas no compatibles se sustituyen por el inglés. Las configuraciones regionales rumanas, como `ro-RO` y `ro-MD`, seleccionan el rumano. Se puede cambiar el idioma en cualquier momento mediante el botón de configuración; al cambiar de idioma, se conservan los borradores del editor.

Utiliza el botón del sol/la luna para cambiar entre los temas claro y oscuro. El modo normal viene por defecto en claro, mientras que el modo incógnito viene por defecto en oscuro. Cada modo recuerda su configuración independientemente del sistema operativo, y las preferencias se sincronizan entre todas las ventanas de la extensión abiertas que estén en el mismo modo.

## Privacidad y control de datos

Sin anuncios, análisis, seguimiento de usuarios ni necesidad de crear una cuenta. Los datos del sitio se procesan en tu dispositivo y no se suben, venden ni comparten con el desarrollador ni con servidores de terceros. Se solicita acceso al sitio web que selecciones, y este acceso puede revocarse en la configuración de la extensión Chrome. Las operaciones que inicies pueden finalizar tras cerrar la ventana emergente o el panel lateral.

Las preferencias, las confirmaciones de acceso a sitios web, los identificadores de favoritos (sin los valores de los elementos), los estados guardados y los resúmenes del historial permanecen en el almacenamiento local de la extensión. Los estados guardados pueden contener los valores de las cookies y del almacenamiento que elijas guardar explícitamente. Los valores completos «antes» y «después», así como los datos de recuperación de operaciones, solo se conservan durante la sesión actual del navegador; al reiniciar Chrome o al recargar la extensión, se borran. Borra los datos de la extensión o desinstálala para eliminar los datos guardados localmente.

Las cookies y el almacenamiento web pueden contener información de inicio de sesión u otros datos confidenciales. Protege los datos copiados y exportados. La herramienta JWT muestra la carga útil decodificada en Base64URL únicamente con fines de inspección. No verifica las firmas ni comprueba si un token de autenticación es fiable o válido. Consulta la [política de privacidad](../../docs/privacy-policy.html) para obtener más información.

## Desarrollo de software

Instala las dependencias de desarrollo y ejecuta las comprobaciones desde la raíz del repositorio:

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

El último comando comprueba la lectura y la modificación de los datos Local Storage y Session Storage de un sitio web en Chromium. Consulte la [referencia de desarrollo y lanzamiento (en inglés)](../../docs/development.md) para conocer los comandos completos de prueba del navegador, las ubicaciones de salida y los detalles sobre la fiabilidad del funcionamiento.

## Lanzamiento y documentación

Versión actual: **0.3.7**. Requiere **Chrome 114 o una versión posterior**.

- [Notas de la versión v0.3.7](../../docs/release-notes-v0.3.7.md)
- [Mantenimiento de la localización](../../docs/localization.md)
- [Formato del paquete de datos del sitio con versiones](../../docs/site-data-package-v1.md)
- [Descripciones de la tienda e imágenes promocionales de la tienda web Chrome](../../store-assets/)
- [Informar de un problema](https://github.com/Atimynyc/cookies-manager/issues)
