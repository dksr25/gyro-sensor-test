'use strict'
/*jshint -W110 */

const fs = require('fs')
const path = require('path') 
const cheerio = require('cheerio') 
const packageJson = JSON.parse(fs.readFileSync('package.json'))
const gulp = require('gulp')
const del = require('del')
const merge = require('merge-stream')
const browserSync = require('browser-sync').create()
const vinylBuffer = require('vinyl-buffer')
const spritesmith = require('gulp.spritesmith-multi')
const gitDateExtractor = require('git-date-extractor')
const getRepoInfo = require('git-repo-info')
const glob = require('glob')
const $ = require('gulp-load-plugins')({
  camelize: true
})

const gulpConfig = {
  autoprefixer: ['> 1%', 'last 2 versions', 'iOS 10', 'Android > 80', 'Firefox ESR', 'IE 11'],
  deployMessage: '[UPDATE] deploy to gh-pages',
  src: './src',
  dist: './dist',
  // sprite-hash option
  spriteHash: true,
  // ejs-template's global variables
  ejsVars: {
  }
}

//////////////////

function sprites() {
  let opts = {
    spritesmith: function (options, sprite, icons) {
      options.imgPath = `../img/${options.imgName}`
      options.cssName = `_${sprite}-mixins.scss`
      options.cssTemplate = `${gulpConfig.src}/scss/vendor/spritesmith-mixins.handlebars`
      options.cssSpritesheetName = sprite
      options.padding = 4
      options.algorithm = 'binary-tree'
      return options
    }
  }
  
  let spriteData = gulp.src(`${gulpConfig.src}/img/sprites/**/*.png`)
    .pipe(spritesmith(opts)).on('error', function (err) {
      console.log(err)
    })

  let imgStream = spriteData.img
    .pipe(vinylBuffer())
    .pipe($.pngquant({
      quality: '90'
    }))
    .pipe(gulp.dest(`${gulpConfig.src}/img`))
  let cssStream = spriteData.css
    .pipe(gulp.dest(`${gulpConfig.src}/scss/vendor`))

  return merge(imgStream, cssStream)
}

function update_normalize() {
  return gulp.src([
    `./node_modules/normalize.css/normalize.css`
  ])
  .pipe($.rename({
    prefix: '_',
    extname: '.scss'
  }))
  .pipe(gulp.dest(`${gulpConfig.src}/scss/common`))
}

function sass() {
  return gulp.src([
      `${gulpConfig.src}/scss/**/*.{sass,scss}`,
      `!${gulpConfig.src}/scss/vendor/*-mixins.scss`
    ],{
      sourcemaps: true,
    })
    .pipe($.sassGlob())
    .pipe($.sass({
      errLogToConsole: true,
      outputStyle: 'compressed'
    }).on('error', $.sass.logError))
    .pipe($.autoprefixer({
      overrideBrowserslist: gulpConfig.autoprefixer,
      remove: false,
      cascade: false
    }))
    .pipe(gulp.dest(`${gulpConfig.dist}/css`, {sourcemaps: true}))
}

function getFolders(dir) {
  let result = [];
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir)
  } 
  else if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
		result = fs.readdirSync(dir).filter((file) => fs.statSync(path.join(dir, file)).isDirectory());
	}
	return result;
}

async function spriteSvg() {
  const folders = getFolders(`${gulpConfig.src}/img/sprites-svg`);

  let options = {
    spritesmith: (options) => {
      const { folder, gulpConfig } = options;
      return {
        shape: {
          spacing: {
            padding: 4
          },
          id: {
            generator: function (name) {
              return path.basename(name.split(`${gulpConfig.src}/scss/vendor`).join(this.separator), '.svg');
            }
          }
        },
        mode: {
          css: {
            dest: './',
            bust: false,
            sprite: folder + '-svg.svg',
            render:  {
              scss: {
                template: path.join(`${gulpConfig.src}/scss/vendor`, 'sprite-svg-mixins.handlebars'),
                dest: path.posix.relative(`${gulpConfig.src}/img`, path.posix.join(`${gulpConfig.src}/scss`, 'vendor', '_'+folder+'-svg-mixins.scss'))
              }
            }
          }
        },
        variables: {
          spriteName: folder,
          baseName: path.posix.relative(`${gulpConfig.src}/css`, path.posix.join(`${gulpConfig.src}/img`, folder + '-svg')),
          svgToPng: ''
        }
      }
    },
  };

  return folders.map((folder) => {
    return new Promise((resolve) => {
      gulp.src(path.join(`${gulpConfig.src}/img/sprites-svg`, folder, '*.svg'))
        .pipe($.sort())
        .pipe($.svgSprite(options.spritesmith({folder, gulpConfig})))
        .pipe(gulp.dest(`${gulpConfig.src}/img`))
        .on('end',resolve);
    });
  });
}

function copy_image() {
  return gulp.src([
      `${gulpConfig.src}/img/**/*`,
      `!${gulpConfig.src}/img/sprites`,
      `!${gulpConfig.src}/img/sprites/**/*`,
      `!${gulpConfig.src}/img/sprites-svg`,
      `!${gulpConfig.src}/img/sprites-svg/**/*`,
    ])
    .pipe(gulp.dest(`${gulpConfig.dist}/img`))
    // .pipe(browserSync.stream())
}

function optimize_png() {
  return gulp.src([
      `${gulpConfig.dist}/img/**/*.png`,
      `!${gulpConfig.dist}/img/**/*.ani.png`,
      `!${gulpConfig.dist}/img/**/sprite*.png`,
    ])
    .pipe($.pngquant({
      quality: '90'
    }))
    .pipe(gulp.dest(`${gulpConfig.dist}/img`))
}

function optimize_others() {
  return gulp.src([
      `${gulpConfig.dist}/img/**/*.{gif,jpg,jpeg,svg}`,
      `!${gulpConfig.dist}/img/**/sprite*.svg`,
    ])
    .pipe($.imagemin([
      $.imagemin.gifsicle({
        interlaced: true
      }), // gif
      $.imagemin.mozjpeg({
        progressive: true
      }), // jpg
      $.imagemin.svgo({ 
        plugins: [
          { removeViewBox: true },
          { cleanupIDs: false }
        ]
      }) // svg
    ], {
      verbose: true
    }))
    .pipe(gulp.dest(`${gulpConfig.dist}/img`))
}

//////////////////

function process_html() {
  return gulp.src([
      `${gulpConfig.src}/html/**/*.html`,
      `!${gulpConfig.src}/html/**/@*`,
      `!${gulpConfig.src}/html/includes/**/*`
    ],{
      since: gulp.lastRun(process_html)
    })
    .pipe($.ejs(gulpConfig.ejsVars))
    .pipe($.jsbeautifier({
      config: '.jsbeautifyrc',
      mode: 'VERIFY_AND_WRITE'
    }))
    .pipe(gulp.dest(`${gulpConfig.dist}/html`))
    // .pipe(browserSync.stream())
}

async function stamps(){
  await gitDateExtractor.getStamps({
   outputToFile: true,
   outputFileName: '../../timestamps.json',
   onlyIn : ['./'],
	 projectRootPath: __dirname+'/src/html'  
  });
}

function make_indexfile(done) {
  let stampData = fs.readFileSync('./timestamps.json'), // stamps 에서 생성한 json 읽기
      jsonStampData = JSON.parse(stampData), // json 파일 이용가능하도록 parse
      dPath = `${gulpConfig.src}/html/`, // index를 생성할 파일들이 있는 저장소
      normalFiles = [], // 파일 정보를 저장할 배열 생성
      ejsNormalFiles = [],
      info = getRepoInfo() // git 정보 생성  

  //ejs 목록 읽고, 저장
  const ejsGlob = glob.sync(`${dPath}/includes/**/*.ejs`)    
  
  ejsGlob.map(function (file) {
    return file.replace(/\.\/src\/html\//, '');
  }).forEach(function (file) {
    let ejsExtname = path.extname(file),
        ejsBasename = file,
        ejsNameText = path.basename(file);
    if(ejsExtname == '.ejs' && ejsNameText.indexOf('_') != 0) {
      let ejsFileData = {};
      //git 기준 마지막 변경 닐짜
      let ejsModifiedDate = jsonStampData[ejsBasename].modified*1000;
      //git 기준 생성 날짜
      let ejsCreatedDate = jsonStampData[ejsBasename].created*1000;
      // 객체에 데이터 집어넣기
      ejsFileData.name = ejsBasename;
      ejsFileData.mdate = new Date(ejsModifiedDate);
      ejsFileData.cdate = new Date(ejsCreatedDate);
      ejsFileData.since = ejsModifiedDate;         
      ejsFileData.age = ejsCreatedDate;
      ejsFileData.ndate = ejsFileData.mdate.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' (GMT+9)';
      ejsNormalFiles.push(ejsFileData);
    }
  });   

  // 파일 목록 읽고, 필요한 정보 저장
  fs.readdir(dPath, function (err, files) {
    if (err) {
      throw err;
    }
    files.map(function (file) {
      return path.join(dPath, file);
    }).filter(function (file) {
      return fs.statSync(file).isFile();
    }).forEach(function (file) {
      //HTML 파일만 거르기
      let extname = path.extname(file),
        basename = path.basename(file);
      if (extname == '.html') {
        
        // 일반 file info를 저장할 객체 생성
        let nfileData = {};
        
        // title 텍스트 값 추출
        let fileInnerText = fs.readFileSync(file, 'utf8');
        let checkresult = [];
        for(let i=0;i<ejsNormalFiles.length;i++){
          if(fileInnerText.replace(/<\!--.+?-->/sg,"").indexOf(`include('${ejsNormalFiles[i].name.replace('.ejs','')}'`)==-1){
            checkresult[i] = false;
          } else {
            checkresult[i] = true;
          }
        }
        let $ = cheerio.load(fileInnerText);
        let wholeTitle = $('title').text(),
        splitTitle = wholeTitle.split(' : '),
        //git 기준 마지막 변경 닐짜
        modifiedDate = jsonStampData[`${basename}`].modified*1000,
        //git 기준 생성 날짜
        createdDate = jsonStampData[`${basename}`].created*1000;
        
        // 객체에 데이터 집어넣기
        nfileData.title = splitTitle[0];
        nfileData.name = path.basename(file);
        nfileData.category = String(nfileData.name).substring(0, 2);
        nfileData.categoryText = splitTitle[1];
        nfileData.mdate = new Date(modifiedDate);
        nfileData.cdate = new Date(createdDate);
        nfileData.since = modifiedDate;         
        nfileData.age = createdDate;
        nfileData.check = checkresult;

        // 파일수정시점 - 대한민국 표준시 기준
        nfileData.ndate = nfileData.mdate.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' (GMT+9)';

        // title 마지막 조각 , 인덱스에 붙은 라벨 식별 및 yet 인 경우 수정날짜정보 제거
        nfileData.status = splitTitle[2];
        if(typeof splitTitle[2] == 'undefined' || splitTitle[2] == null || splitTitle[2] == '') {
          nfileData.status = '';
        }
        else if(splitTitle[2] == 'yet') {
          nfileData.mdate = '';
          nfileData.ndate = '';
        } 
        normalFiles.push(nfileData);

      }
    });
    let projectObj = {
      nfiles: normalFiles,
      ejsFiles: ejsNormalFiles,
      branch: info.branch
    }
    let projectObjStr = JSON.stringify(projectObj);
    let projectObjJson = JSON.parse(projectObjStr);

    //index 파일 쓰기
    return gulp.src('index.html')
      .pipe($.ejs(projectObjJson))
      .pipe(gulp.dest(gulpConfig.dist))
      // .pipe(browserSync.stream())
  });
  browserSync.reload();
  del('./timestamps.json');
  done()  
}

function server(done) {
  // serve files from the build folder
  browserSync.init({
    port: 8030,
    ui: {
      port: 8033,
      weinre: {
        port: 8133
      }
    },
    cors: false, // if you need CORS, set true
    server: {
      baseDir: `${gulpConfig.dist}/`
    }
  },() => {
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] Watch initialize complete...');
  })
  
  // watch images
  gulp.watch([
    `${gulpConfig.src}/img/**/*`,
    `!${gulpConfig.src}/img/sprite*.png`,
    `!${gulpConfig.src}/img/sprite*.svg`
  ], gulp.series(() => {return del(`${gulpConfig.dist}/img`)}, sprites, sass, spriteSvg, copy_image, (done) => {
    browserSync.reload();
    done();
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] IMG watch complete...');
  }));

  // watch scss
  gulp.watch([
    `${gulpConfig.src}/scss/**/*`,
    `!${gulpConfig.src}/scss/vendor/*-mixins.scss`
  ], gulp.series(() => {return del(`${gulpConfig.dist}/css`)}, sass, (done) => {
    browserSync.reload();
    done();
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] SCSS watch complete...');
  }));

  // watch html
  gulp.watch([
    `${gulpConfig.src}/html/**/*`,
    `!${gulpConfig.src}/html/includes/**/*`
  ], gulp.series(process_html, stamps, make_indexfile, (done) => {
    browserSync.reload();
    done();
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] HTML watch complete...');
  }));

  // watch includes
  gulp.watch([
    `${gulpConfig.src}/html/includes/**/*`
  ], gulp.series(() => {return del(`${gulpConfig.dist}/html`)}, process_html_in_build, stamps, make_indexfile, (done) => {
    browserSync.reload();
    done();
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] INCLUDES watch complete...');
  }));

  // watch index
  gulp.watch('index.html', gulp.series(stamps, make_indexfile, (done) => {
    browserSync.reload();
    done();
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] INDEX watch complete...');
  }));

  done();
}

function markup_watch(done) {
  gulp.series(clean_dist, stamps, make_indexfile, sprites, sass, spriteSvg, copy_image, process_html, server)();
  done();
}

/**
 * CSS: watch for style auto-compile
 * @example gulp
 */
exports.default = markup_watch

//////////////////

function clean_dist() {
  return del(gulpConfig.dist)
}

function sass_in_build() {
  return gulp.src([
    `${gulpConfig.src}/scss/**/*.{sass,scss}`,
    `!${gulpConfig.src}/scss/vendor/*-mixins.scss`
  ])
  .pipe($.sassGlob())
  .pipe($.sass({
    errLogToConsole: true,
    outputStyle: 'compressed'
  }).on('error', $.sass.logError))
  .pipe($.autoprefixer({
    overrideBrowserslist: gulpConfig.autoprefixer,
    remove: false,
    cascade: false
  }))
  .pipe(gulp.dest(`${gulpConfig.dist}/css`))
}

function process_html_in_build() {
  return gulp.src([
    `${gulpConfig.src}/html/**/*.html`,
    `!${gulpConfig.src}/html/**/@*`,
    `!${gulpConfig.src}/html/includes/**/*`
  ])
  .pipe($.ejs(gulpConfig.ejsVars))
  .pipe($.jsbeautifier({
    config: '.jsbeautifyrc',
    mode: 'VERIFY_AND_WRITE'
  }))
  .pipe(gulp.dest(`${gulpConfig.dist}/html`))
}

//////////////////

function zip() {
  let date = new Date()
  let dateFormatted = `${date.getFullYear()}${('0' + (date.getMonth() + 1)).slice(-2)}${('0' + date.getDate()).slice(-2)}T${('0' + date.getHours()).slice(-2)}${('0' + date.getMinutes()).slice(-2)}`
  return gulp.src([
    `${gulpConfig.dist}/**/*`,
    `!${gulpConfig.dist}/**/*.zip`,
    `!${gulpConfig.dist}/rev-manifest.json`,
  ])
  .pipe($.zip(`${packageJson.name}_${packageJson.version}_${dateFormatted}.zip`))
  .pipe(gulp.dest(gulpConfig.dist))
}

function markup_build(done) {
  gulp.series(clean_dist, update_normalize, stamps, make_indexfile, sprites, sass_in_build, spriteSvg, copy_image, process_html_in_build, zip, (done) => {
   console.log('\x1b[32m%s\x1b[0m', '[--:--:--] Build complete...')
   done()
  })()
  done()
}

/**
 * build: build for style auto-compile
 * @example gulp build
 */
exports.build = markup_build

//////////////////

function axe_test() {
  let options = {
    headless: false,
    urls:[`${gulpConfig.dist}/html/*.html`],
  };
  return $.axeWebdriver(options);
}

/**
 * check: html accessibility check
 * @example gulp check
 */
exports.check = axe_test

//////////////////

function sprite_img_rename(done) {	
  return gulpConfig.spriteHash ? gulp.src([
    `${gulpConfig.dist}/img/sprite*.png`,
    `${gulpConfig.dist}/img/sprite*.svg`,
  ],{base: `${gulpConfig.dist}`})	
  .pipe($.rev())
  .pipe($.revDeleteOriginal())
  .pipe(gulp.dest(`${gulpConfig.dist}`))
  .pipe($.rev.manifest())
  .pipe(gulp.dest(`${gulpConfig.dist}`)) : done()
}

function sprite_css_rewrite(done) {
  const manifest = gulpConfig.spriteHash ? gulp.src(`${gulpConfig.dist}/rev-manifest.json`) : false;
  
  return gulpConfig.spriteHash ? gulp.src(`${gulpConfig.dist}/css/*.css`)
  .pipe($.revRewrite({ manifest }))
  .pipe(gulp.dest(`${gulpConfig.dist}/css`)) : done()
}

function source_deploy() {
  return gulp.src([
    `${gulpConfig.dist}/**/*`,
    `!${gulpConfig.dist}/css/*.css.map`,
    `!${gulpConfig.dist}/rev-manifest.json`,
    ])
    .pipe($.ghPages({
      message: gulpConfig.deployMessage
    }))
}

function markup_deploy(done) {
  gulp.series(clean_dist, update_normalize, stamps, make_indexfile, sprites, sass_in_build, spriteSvg, copy_image, optimize_png, optimize_others, process_html_in_build, sprite_img_rename, sprite_css_rewrite, zip, source_deploy, (done) => {
    console.log('\x1b[32m%s\x1b[0m', '[--:--:--] Build & Deploy complete...')
   done()
  })()
  done()
}

/**
 * deploy: deploy for style auto-compile
 * @example gulp deploy
 */
exports.deploy = markup_deploy
