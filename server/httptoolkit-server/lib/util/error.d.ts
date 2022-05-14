export declare type ErrorLike = Partial<Error> & {
    code?: string;
    cmd?: string;
    signal?: string;
};
export declare function isErrorLike(error: any): error is ErrorLike;
