// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {SimpleAccountFactoryCompat} from "../src/SimpleAccountFactoryCompat.sol";

import {FeeVault} from "../src/FeeVault.sol";
import {QuickPayV5Router} from "../src/QuickPayV5Router.sol";

contract DeployPrereqs is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address entryPointAddr = vm.envAddress("ENTRYPOINT");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");

        vm.startBroadcast(pk);

        FeeVault feeVault = new FeeVault(feeCollector);
        QuickPayV5Router router = new QuickPayV5Router(address(feeVault));
        SimpleAccountFactoryCompat factory = new SimpleAccountFactoryCompat(IEntryPoint(entryPointAddr));

        vm.stopBroadcast();

        console2.log("FEEVAULT:", address(feeVault));
        console2.log("ROUTER:", address(router));
        console2.log("FACTORY:", address(factory));
    }
}
