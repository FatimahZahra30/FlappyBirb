/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import { start } from "node:repl";
import "./style.css";

import {
    Observable,
    BehaviorSubject,
    catchError,
    filter,
    fromEvent,
    interval,
    merge,
    map,
    scan,
    switchMap,
    take,
    takeWhile,
    share,
    toArray,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

const Birb = {
    WIDTH: 42,
    HEIGHT: 30,
} as const;

const Constants = {
    PIPE_WIDTH: 50,
    TICK_RATE_MS: 60, // Might need to change this!
    PIPE_SPEED: 8,
    GRAVITY: 1.5,
    SEED: 1234,
} as const;

// User input

type Key = "Space";

// State processing

type Rectangle = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

type BirdState = {
    y: number;
    vel: number;
};

type PipeState = {
    id: string;
    x: number;
    gapY: number;
    gapHeight: number;
    time: number;
    hasHitBird: boolean;
    hasScored: boolean;
};

type Run = {
    positions: number[]; // bird y sampled each tick
    tickRateMs: number;
    durationTicks: number;
};

type State = Readonly<{
    bird: BirdState;
    pipes: PipeState[];
    pipeCount: number;
    score: number;
    lives: number;
    exit: { id: string }[];
    gameEnd: boolean;
    nextPipeIndex: number;
    randomVel: number;
    tick: number;
}>;

const initialState: State = {
    bird: { y: Viewport.CANVAS_HEIGHT / 2, vel: 0 },
    pipes: [],
    pipeCount: 0,
    score: 0,
    lives: 3,
    exit: [],
    gameEnd: false,
    nextPipeIndex: 0,
    randomVel: 0,
    tick: 0,
};

// holds details of all past runs
export const runsSubject = new BehaviorSubject<Run[]>([]);

const winStreak$ = new BehaviorSubject<number>(0);

/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State) => s;

// Rendering (side effects)

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

/**
 * This code has been taken from the week 4 applied work
 * which was given by the teaching team.
 * A random number generator which provides two pure functions
 * `hash` and `scale`. Call `hash` repeatedly to generate the
 * sequence of hashes.
 */
abstract class RNG {
    private static m = 0x80000000; // 2^31
    private static a = 1103515245;
    private static c = 12345;

    public static hash = (seed: number): number =>
        (RNG.a * seed + RNG.c) % RNG.m;

    public static scale = (hash: number): number =>
        (2 * hash) / (RNG.m - 6) - 6; // in [-6, 6]
}

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

const render = (): ((s: State) => void) => {
    // Canvas elements
    const gameOver = document.querySelector("#gameOver") as SVGElement;

    // Text fields
    const livesText = document.querySelector("#livesText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;

    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );
    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    return (s: State) => {
        // updates the position of the bird
        const bird = document.getElementById(
            "bird",
        ) as unknown as SVGImageElement;
        bird.setAttribute("y", `${s.bird.y - Birb.HEIGHT / 2}`);

        const pipesGroup = document.getElementById(
            "pipes",
        ) as unknown as SVGGElement;

        // array of Run
        const pastRuns = runsSubject.value;

        const ghostsGroup = document.getElementById("ghosts")!;

        // iterates through each of the gameplay and produces ghost for it
        pastRuns.forEach((run, i) => {
            const ghostId = `ghost-${i}`;

            const ghostElem =
                (document.getElementById(ghostId) as SVGImageElement | null) ??
                ((): SVGImageElement =>
                    ghostsGroup.appendChild(
                        createSvgElement(svg.namespaceURI, "image", {
                            id: ghostId,
                            href: "assets/birb.png",
                            x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
                            y: `${Viewport.CANVAS_HEIGHT / 2 - Birb.HEIGHT / 2}`,
                            width: `${Birb.WIDTH}`,
                            height: `${Birb.HEIGHT}`,
                            opacity: "0.35",
                            pointerEvents: "none",
                        }) as SVGImageElement,
                    ) as SVGImageElement)();

            // compute sample index and y position
            const index = s.tick;
            if (index < run.positions.length) {
                ghostElem.setAttribute(
                    "y",
                    `${run.positions[index] - Birb.HEIGHT / 2}`,
                );
                ghostElem.setAttribute("visibility", "visible");
            } else {
                // hides the ghost when ticks are over
                ghostElem.setAttribute("visibility", "hidden");
            }
        });

        // chatgpt was used to give a suggestion on how to spawn
        // different pipes which was by looping through the pipes
        s.pipes.forEach(pipe => {
            if (!document.getElementById(`${pipe.id}-top`)) {
                const pipeTop = createSvgElement(svg.namespaceURI, "rect", {
                    id: `${pipe.id}-top`,
                    x: `${pipe.x}`,
                    y: "0",
                    width: `${Constants.PIPE_WIDTH}`,
                    height: `${pipe.gapY - pipe.gapHeight / 2}`,
                    fill: "green",
                });
                const pipeBottom = createSvgElement(svg.namespaceURI, "rect", {
                    id: `${pipe.id}-bottom`,
                    x: `${pipe.x}`,
                    y: `${pipe.gapY + pipe.gapHeight / 2}`,
                    width: `${Constants.PIPE_WIDTH}`,
                    height: `${Viewport.CANVAS_HEIGHT - (pipe.gapY + pipe.gapHeight / 2)}`,
                    fill: "green",
                });
                pipesGroup.appendChild(pipeTop);
                pipesGroup.appendChild(pipeBottom);
            } else {
                // update existing pipe position
                const top = document.getElementById(`${pipe.id}-top`)!;
                const bottom = document.getElementById(`${pipe.id}-bottom`)!;
                top.setAttribute("x", `${pipe.x}`);
                bottom.setAttribute("x", `${pipe.x}`);
            }
        });

        // remove old pipes based on the id
        s.exit.forEach(p => {
            const top = document.getElementById(`${p.id}-top`);
            const bottom = document.getElementById(`${p.id}-bottom`);
            top && pipesGroup.removeChild(top);
            bottom && pipesGroup.removeChild(bottom);
        });

        scoreText.textContent = s.score.toString();
        livesText.textContent = s.lives.toString();

        if (s.gameEnd) {
            show(gameOver);
        } else {
            hide(gameOver);
        }
    };
};

/**
 * Code has been taken from the week 4 applied work which was provided.
 * Converts values in a stream to random numbers in the range [-1, 1]
 *
 * This usually would be implemented as an RxJS operator,but that is currently
 * beyond the scope of this course.
 *
 * @param source$ The source Observable, elements of
 * this are replaced with random numbers
 * @param seed The seed for the random number generator
 */
export function createRngStreamFromSource<T>(source$: Observable<T>) {
    return function createRngStream(seed: number = 0): Observable<number> {
        const randomNumberStream = source$.pipe(
            // updates the seed on each tick
            scan(oldSeed => RNG.hash(oldSeed), seed),
            // takes the hashed seed and turns it into a usable random number
            // that is scaled between -1 and 1
            map(hashedSeed => RNG.scale(hashedSeed)),
        );

        return randomNumberStream;
    };
}

const rng$ = createRngStreamFromSource(interval(100))(Constants.SEED).pipe(
    // every 100ms, a new random num is produced
    // transforms that random number into a velocity between -6 and -12
    map(randomNum => randomNum * -6 - 6),
);

export const state$ = (csvContents: string): Observable<State> => {
    // code similar to the week 3 applied
    const pipeSchedule = csvContents
        .trim()
        .split("\n")
        .slice(1) // skip header row
        .map(line => {
            const [gapY, gapHeight, time] = line.split(",");
            return {
                gapY: parseFloat(gapY),
                gapHeight: parseFloat(gapHeight),
                time: parseFloat(time),
            };
        });

    /** User input */

    const key$ = fromEvent<KeyboardEvent>(document, "keypress");
    const fromKey = (keyCode: Key) =>
        key$.pipe(
            filter(({ code }) => code === keyCode),
            map(() => (s: State) => ({
                ...s,
                bird: { ...s.bird, vel: -10 },
            })),
        );

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS);

    // the bird proximity that could possible hit the pipes or
    // top and bottom of the screen
    function getBirdRect(y: number): Rectangle {
        // bird is 30% of viewport in render()
        const birdLeft = Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2;
        const birdRight = birdLeft + Birb.WIDTH;
        const birdTop = y - Birb.HEIGHT / 2;
        const birdBottom = birdTop + Birb.HEIGHT;

        return {
            left: birdLeft,
            right: birdRight,
            top: birdTop,
            bottom: birdBottom,
        };
    }

    // the pipe proximity
    function getPipeRect(pipe: PipeState): [Rectangle, Rectangle] {
        const topPipe: Rectangle = {
            left: pipe.x,
            right: pipe.x + Constants.PIPE_WIDTH,
            top: 0,
            bottom: pipe.gapY - pipe.gapHeight / 2,
        };

        const bottomPipe: Rectangle = {
            left: pipe.x,
            right: pipe.x + Constants.PIPE_WIDTH,
            top: pipe.gapY + pipe.gapHeight / 2,
            bottom: Viewport.CANVAS_HEIGHT,
        };

        return [topPipe, bottomPipe];
    }

    // checking for collisions by seeing if any part of the bird
    // overlaps with any part of the pipes
    function isColliding(a: Rectangle, b: Rectangle): Boolean {
        return (
            a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top
        );
    }

    /**
     * chatgpt gave the suggestion for a tick reducer which
     * i modified to work for my implementation and idea.
     * this is where most of the game logic and state management occurs
     * @param tickCount
     * @returns
     */
    const tickReducer = (tickCount: number) => (s: State) => {
        const newVel = s.bird.vel + Constants.GRAVITY;
        const newY = s.bird.y + newVel;

        const elapsedSeconds = tickCount * (Constants.TICK_RATE_MS / 1000);

        // Recompute pipe positions directly from CSV times
        const movedPipes = s.pipes.map(pipe => ({
            ...pipe,
            x: pipe.x - Constants.PIPE_SPEED,
        }));

        // Pipes that moved off screen
        const removedPipes = movedPipes.filter(
            pipe => pipe.x + Constants.PIPE_WIDTH <= 0,
        );

        // Keep only the visible ones
        const updatedPipes = movedPipes.filter(
            pipe => pipe.x + Constants.PIPE_WIDTH > 0,
        );

        // Spawn new pipes according to schedule
        const upcoming = pipeSchedule.slice(s.nextPipeIndex);
        const duePipes = upcoming.filter(p => p.time <= elapsedSeconds);

        const newPipes = duePipes.map(p => ({
            id: String(s.pipeCount),
            time: p.time,
            gapY: p.gapY * Viewport.CANVAS_HEIGHT,
            gapHeight: p.gapHeight * Viewport.CANVAS_HEIGHT,
            x: Viewport.CANVAS_WIDTH,
            hasHitBird: false,
            hasScored: false,
        }));

        const birdRect = getBirdRect(newY);

        // checks if a top or bottom pipe has been hit
        const collidedPipes = updatedPipes.find(
            pipe =>
                !pipe.hasHitBird &&
                getPipeRect(pipe).some(rect => isColliding(birdRect, rect)),
        );

        const velAfterCollision = (() => {
            // collisions with the top or bottom pipes
            if (collidedPipes) {
                const [topRect, bottomRect] = getPipeRect(collidedPipes);
                if (isColliding(birdRect, topRect)) {
                    return Math.abs(s.randomVel);
                } else if (isColliding(birdRect, bottomRect)) {
                    return -Math.abs(s.randomVel);
                }
            }

            // collisions with the top or bottom of the screen
            if (birdRect.top <= 0) {
                return Math.abs(s.randomVel);
            } else if (birdRect.bottom >= Viewport.CANVAS_HEIGHT) {
                return -Math.abs(s.randomVel);
            }

            // Normal velocity if non of the conditions are met
            return newVel;
        })();

        // checks if the bird hit the pipe
        const updatedPipesWithHit = updatedPipes.map(pipe =>
            pipe === collidedPipes ? { ...pipe, hasHitBird: true } : pipe,
        );

        // finds the pipes that have already been passed
        const passedPipes = updatedPipesWithHit.filter(
            pipe =>
                birdRect.left > pipe.x + Constants.PIPE_WIDTH &&
                !pipe.hasHitBird &&
                !pipe.hasScored,
        );

        // increments score by the number of pipes that have been passed
        const incrementScore = passedPipes.length;

        // marks the passed pipes as scored
        const scoredPipes = updatedPipesWithHit.map(pipe => ({
            ...pipe,
            hasScored: pipe.hasScored || passedPipes.includes(pipe),
        }));

        // checks if bird hit the pipe
        const hitPipe = !!collidedPipes;

        // checks if bird hit the top or bottom of the screen
        const birdHitBoundary =
            birdRect.top <= 0 || birdRect.bottom >= Viewport.CANVAS_HEIGHT;

        // if the bird hit any area, 1 life is lost for each hit
        const loseLife = hitPipe || birdHitBoundary ? 1 : 0;

        // calculates the new life and the minimum lives is 0
        const newLife = Math.max(0, s.lives - loseLife);

        // checks if the bird has passed all the pipes
        const wonGame =
            s.score >= pipeSchedule.length ||
            (s.nextPipeIndex >= pipeSchedule.length && s.pipes.length === 0);

        return {
            ...s,
            bird: { ...s.bird, y: newY, vel: velAfterCollision },
            pipes: [...scoredPipes, ...newPipes],
            pipeCount: s.pipeCount + newPipes.length,
            nextPipeIndex: s.nextPipeIndex + duePipes.length,
            lives: newLife,
            exit: s.exit.concat(removedPipes.map(p => ({ id: p.id }))),
            score: s.score + incrementScore,
            gameEnd: newLife < 1 || wonGame,
            tick: s.tick + 1,
        };
    };

    // observable stream for the game play
    const game$ = merge(
        // emits something every i milliseconds
        tick$.pipe(map((_, i) => tickReducer(i))),
        fromKey("Space"),
        // emits random numbers which get mapped to the velocity
        rng$.pipe(map(randomVel => (s: State) => ({ ...s, randomVel }))),
    ).pipe(
        // stream of game states over time
        scan((state, reducerFn) => reducerFn(state), {
            ...initialState,
            randomVel: 0,
        }),
        // ends the current round of the game if gameEnd is true
        takeWhile(state => !state.gameEnd, true),
    );

    return game$;
};

// The following simply runs your main function on window load.
// Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    const { protocol, hostname, port } = new URL(import.meta.url);
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    const csvUrl = `${baseUrl}/assets/map.csv`;

    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    // background only created once
    const background = createSvgElement(svg.namespaceURI, "image", {
        href: "assets/flappy_background.png",
        x: "0",
        y: "0",
        width: `${Viewport.CANVAS_WIDTH}`,
        height: `${Viewport.CANVAS_HEIGHT}`,
        preserveAspectRatio: "none",
    });
    svg.appendChild(background);

    // group to hold pipes
    const pipesGroup = createSvgElement(svg.namespaceURI, "g", { id: "pipes" });
    svg.appendChild(pipesGroup);

    // bird which is created once and updated later on
    const birdImg = createSvgElement(svg.namespaceURI, "image", {
        id: "bird",
        href: "assets/birb.png",
        x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
        y: `${Viewport.CANVAS_HEIGHT / 2 - Birb.HEIGHT / 2}`,
        width: `${Birb.WIDTH}`,
        height: `${Birb.HEIGHT}`,
    });
    svg.appendChild(birdImg);

    const ghostsGroup = createSvgElement(svg.namespaceURI, "g", {
        id: "ghosts",
    });
    svg.appendChild(ghostsGroup);

    /**
     * code for clearing out the viusals
     */
    const clearGame = () => {
        const pipesGroup = document.getElementById(
            "pipes",
        ) as unknown as SVGGElement;
        // remove all pipes
        if (pipesGroup) pipesGroup.innerHTML = "";

        // resets the bird position
        const bird = document.getElementById("bird");
        if (bird) {
            bird.setAttribute(
                "y",
                `${Viewport.CANVAS_HEIGHT / 2 - Birb.HEIGHT / 2}`,
            );
        }
    };

    function startGame(contents: string) {
        clearGame();

        const newGame$ = state$(contents).pipe(share());

        newGame$.subscribe(render());

        // record ghost run
        newGame$
            .pipe(
                // only takes the birds vertical position
                map(s => s.bird.y),
                // collects those positions into an array
                toArray(),
                map(positions => ({
                    // the array of bird.y values per tick
                    positions,
                    // how often the sample was taken
                    tickRateMs: Constants.TICK_RATE_MS,
                    // total no. of ticks in the run
                    durationTicks: positions.length,
                })),
            )
            .subscribe(run => runsSubject.next([...runsSubject.value, run]));

        // when game ends, wait for R key then restart
        newGame$.pipe(filter(s => s.gameEnd)).subscribe(s => {
            // handle streak and bird color immediately when game ends
            // player won if they still have lives at then end of the game
            const won = s.lives > 0;
            const streak = won ? winStreak$.value + 1 : 0;
            winStreak$.next(streak);

            const bird = document.getElementById(
                "bird",
            ) as unknown as SVGImageElement;
            if (streak >= 2) {
                // special blue color
                bird.style.filter = "hue-rotate(180deg)";
            } else {
                bird.style.filter = "";
            }

            // wait for R key to restart
            fromEvent<KeyboardEvent>(document, "keydown")
                .pipe(
                    filter(({ code }) => code === "KeyR"),
                    take(1),
                )
                .subscribe(() => startGame(contents));
        });
    }

    // Get the file from URL
    const csv$ = fromFetch(csvUrl).pipe(
        switchMap(response => {
            if (response.ok) {
                return response.text();
            } else {
                throw new Error(`Fetch error: ${response.status}`);
            }
        }),
        catchError(err => {
            console.error("Error fetching the CSV file:", err);
            throw err;
        }),
    );

    // Observable: wait for first user click
    const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

    csv$.pipe(
        switchMap(contents =>
            click$.pipe(
                // only takes the first click
                take(1),
                // ignores click events and emits content from csv
                map(() => contents),
            ),
        ),
        // emits the start game
    ).subscribe(contents => startGame(contents));
}
